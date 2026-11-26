import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  History as HistoryIcon,
  Image as ImageIcon,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { adminApi } from '../../api/api';
import { ApiError } from '../../api/httpClient';
import { mediaUrl } from '../../api/config';
import type {
  ScraperFailureKind,
  ScraperReading,
  ScraperRow,
  ScraperRun,
  ScraperSchedule,
  ScraperSearchParams,
  ScraperSort,
  ScraperState,
  ScraperTarget,
} from '../../api/types';
import type { Language, LocalizedString } from '../../types';
import { ADMIN_PAGE_SIZE, AdminPagination } from './AdminPagination';
import { AdminModal } from './AdminModal';

type Tr = (en: string, ar: string) => string;

const SEARCH_DEBOUNCE_MS = 300;

/** The shops are other people's servers: "scrape all" reads their pages one at a time, with a pause in between. */
const PAUSE_BETWEEN_CHECKS_MS = 1000;

/**
 * The schedule is read again while the tab is open, so a run that starts or ends at night shows up without a reload.
 * A run in progress is followed more closely, and the list is refreshed with it so prices appear as they are read.
 */
const SCHEDULE_POLL_IDLE_MS = 60_000;
const SCHEDULE_POLL_RUNNING_MS = 10_000;

/** The host looks at the schedule twice a minute, so a run has started this long after its moment. */
const SCHEDULE_START_LAG_MS = 35_000;

/** The longest delay a browser timer keeps (a larger one fires at once). */
const MAX_TIMER_MS = 2_147_483_647;

const DEFAULT_SCHEDULE_TIME = '03:00';
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const STATES: ScraperState[] = ['all', 'linked', 'unlinked', 'cheaper', 'dearer', 'failed'];
const SORTS: ScraperSort[] = ['product', 'gap', 'checked'];

const STATE_LABEL: Record<ScraperState, LocalizedString> = {
  all: { en: 'All products', ar: 'كل المنتجات' },
  linked: { en: 'With a source URL', ar: 'لها رابط مصدر' },
  unlinked: { en: 'Without a source URL', ar: 'بدون رابط مصدر' },
  cheaper: { en: 'Source is cheaper', ar: 'المصدر أرخص' },
  dearer: { en: 'Source is dearer', ar: 'المصدر أغلى' },
  failed: { en: 'Last scrape failed', ar: 'فشل آخر سحب' },
};

const SORT_LABEL: Record<ScraperSort, LocalizedString> = {
  product: { en: 'Product name', ar: 'اسم المنتج' },
  gap: { en: 'Where we are dearest', ar: 'حيث نحن الأغلى' },
  checked: { en: 'Oldest scrape first', ar: 'الأقدم سحباً أولاً' },
};

/**
 * The Arabic wording of each way a check can fail. The English wording is the server's own (it stores it with the
 * link), so only Arabic needs a copy; a failure the server did not name falls back to the server's text.
 */
const FAILURE_AR: Record<ScraperFailureKind, string> = {
  NoPrice: 'لم يُعثر على سعر في تلك الصفحة. تأكد من أن الرابط يفتح صفحة منتج واحد؛ فبعض المتاجر تخفي أسعارها عن الفحص الآلي.',
  Blocked: 'لا يمكن فحص هذا العنوان: فهو يشير إلى شبكة خاصة أو داخلية.',
  Refused: 'رفض المتجر الفحص (فهو يمنع الزيارات الآلية). حاول لاحقاً أو افتح الصفحة بنفسك.',
  NotFound: 'هذه الصفحة لم تعد موجودة (أجاب المتجر بأنها غير موجودة). تحقق من الرابط.',
  Unreachable: 'تعذّر الوصول إلى المتجر. تحقق من الرابط وحاول مرة أخرى.',
  TimedOut: 'تأخر المتجر كثيراً في الرد.',
  TooLarge: 'هذه الصفحة أكبر من أن تُقرأ.',
  NotAPage: 'هذا الرابط لا يؤدي إلى صفحة ويب.',
  Failed: 'فشل الفحص. حاول مرة أخرى لاحقاً.',
};

function localeOf(language: Language): string {
  return language === 'ar' ? 'ar-EG' : 'en-GB';
}

function formatMoment(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(localeOf(language), { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A moment of the automatic run, on the shop's clock (the time an administrator chose is read there, so the moment it
 * resolves to is shown there too). A zone the browser does not know is shown on the browser's own clock.
 */
function formatShopMoment(iso: string, language: Language, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return new Date(iso).toLocaleString(localeOf(language), { ...options, timeZone });
  } catch {
    return new Date(iso).toLocaleString(localeOf(language), options);
  }
}

/** "03:00" for the language's clock; the date is fixed and in UTC so only the time of day is shown, whatever the browser's zone. */
function formatClock(time: string, language: Language): string {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hours, minutes)).toLocaleTimeString(localeOf(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function zoneLabel(timeZone: string, tr: Tr): string {
  return timeZone === 'Africa/Cairo' ? tr('Cairo time', 'بتوقيت القاهرة') : timeZone;
}

/** "38 pages", "صفحتين": the noun agrees with the number. */
function countPages(count: number, tr: Tr): string {
  if (count === 1) {
    return tr('1 page', 'صفحة واحدة');
  }
  if (count === 2) {
    return tr('2 pages', 'صفحتين');
  }
  return count >= 3 && count <= 10 ? tr(`${count} pages`, `${count} صفحات`) : tr(`${count} pages`, `${count} صفحة`);
}

/** How the latest automatic run went, in a sentence. */
function runSummary(run: ScraperRun, timeZone: string, language: Language, tr: Tr): string {
  if (run.finishedAtUtc === null) {
    return tr(
      `Scraping now: ${run.done} of ${countPages(run.total, tr)} read.`,
      `جارٍ السحب الآن: تمت قراءة ${run.done} من ${countPages(run.total, tr)}.`,
    );
  }
  const when = formatShopMoment(run.startedAtUtc, language, timeZone);
  if (run.interrupted) {
    return tr(
      `Last run ${when} stopped early: ${run.done} of ${countPages(run.total, tr)} were read, ${run.found} showed a price.`,
      `توقف آخر تشغيل ${when} مبكراً: قُرئت ${run.done} من ${countPages(run.total, tr)}، وظهر سعر في ${run.found}.`,
    );
  }
  if (run.total === 0) {
    return tr(
      `Last run ${when}: no product had a source URL, so nothing was read.`,
      `آخر تشغيل ${when}: لم يكن لأي منتج رابط مصدر، فلم تُقرأ أي صفحة.`,
    );
  }
  return tr(
    `Last run ${when}: ${run.found} of ${countPages(run.total, tr)} showed a price.`,
    `آخر تشغيل ${when}: ظهر سعر في ${run.found} من ${countPages(run.total, tr)}.`,
  );
}

/** A price as the other shop's page states it: ours (EGP) the way the console prints money, anything else as read. */
function formatReadingPrice(
  reading: ScraperReading,
  money: (amount: number) => string,
  tr: Tr,
  language: Language,
): string {
  if (reading.currency?.toUpperCase() === 'EGP') {
    return money(reading.price);
  }
  const number = reading.price.toLocaleString(localeOf(language), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return reading.currency
    ? `${number} ${reading.currency}`
    : `${number} (${tr('currency not stated', 'العملة غير مذكورة')})`;
}

function failureText(row: ScraperRow, language: Language): string | null {
  if (row.lastError === null) {
    return null;
  }
  return language === 'ar' && row.lastErrorKind !== null ? FAILURE_AR[row.lastErrorKind] : row.lastError;
}

/**
 * Why a row cannot be applied, in the console's own words. The server decides whether it can (`canApply`); this only
 * explains, from what the row shows, which rule stopped it.
 */
function applyBlockedReason(row: ScraperRow, tr: Tr): string | null {
  if (row.canApply) {
    return null;
  }
  if (row.url === null) {
    return tr('Add a source URL first.', 'أضف رابط مصدر أولاً.');
  }
  if (row.latest === null) {
    return tr('There is no scraped price yet. Scrape the page first.', 'لا يوجد سعر مسحوب بعد. اسحب السعر من الصفحة أولاً.');
  }
  if (!row.latest.currency) {
    return tr(
      'The page does not say which currency its price is in, so it cannot be applied.',
      'لا تذكر الصفحة عملة سعرها، لذلك لا يمكن تطبيقه.',
    );
  }
  if (row.latest.currency.toUpperCase() !== 'EGP') {
    return tr(
      `The scraped price is in ${row.latest.currency}, not EGP.`,
      `السعر المسحوب بعملة ${row.latest.currency} وليس EGP.`,
    );
  }
  return tr('That price was read too long ago. Scrape the page again first.', 'قُرئ هذا السعر منذ وقت طويل. اسحب السعر من الصفحة مرة أخرى أولاً.');
}

const GapBadge: React.FC<{ gap: number | null; language: Language; tr: Tr }> = ({ gap, language, tr }) => {
  if (gap === null) {
    return (
      <span className="text-[#B49AA6]" data-field="gap">
        —
      </span>
    );
  }
  const tone =
    gap < 0 ? 'bg-rose-100 text-rose-800' : gap > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-800';
  const title =
    gap < 0
      ? tr('The source page is cheaper than we are', 'صفحة المصدر أرخص منا')
      : gap > 0
        ? tr('The source page is dearer than we are', 'صفحة المصدر أغلى منا')
        : tr('The same price', 'السعر نفسه');
  const text = gap.toLocaleString(localeOf(language), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${tone}`}
      title={title}
      dir="ltr"
      data-field="gap"
    >
      {text}
    </span>
  );
};

type BusyKind = 'check' | 'apply' | 'link';

interface BulkState {
  running: boolean;
  stopping: boolean;
  total: number;
  done: number;
  found: number;
  without: number;
  /** The SKU being scraped. */
  current: string | null;
  stopped: boolean;
  /** Why the run ended early (the session ended), when it did. */
  error: string | null;
}

interface HistoryView {
  row: ScraperRow;
  readings: ScraperReading[] | null;
  error: string | null;
}

interface ScheduleDraft {
  enabled: boolean;
  time: string;
}

interface ScraperTabProps {
  /** The console's wording of a failed request: localised, and never the server's English prose in Arabic. */
  describeError: (error: unknown) => string;
  /** Money as the console prints it (cents kept, EGP / ج.م). */
  money: (amount: number) => string;
}

/**
 * Price scraper: every product is listed, and each can be given the address of the same product's page at another shop
 * (its source URL). The server reads the price that page shows, the list shows it beside ours, and an administrator can
 * apply it (less a reduction) to the product. The same reading can also happen by itself at a time of day chosen here.
 * The server decides what can be applied and how the prices compare; this tab only shows it and asks for it.
 */
export const ScraperTab: React.FC<ScraperTabProps> = ({ describeError, money }) => {
  const { l, language } = useLanguage();
  const { showToast } = useToast();
  const tr: Tr = (en, ar) => (language === 'ar' ? ar : en);
  const scheduleIds = useId();
  const scheduleTimeId = `${scheduleIds}-time`;
  const scheduleHintId = `${scheduleIds}-hint`;

  const [rows, setRows] = useState<ScraperRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [state, setState] = useState<ScraperState>('all');
  const [sort, setSort] = useState<ScraperSort>('product');
  const [page, setPage] = useState(1);

  /** Taken off the scraped price by "Apply" and "Apply all prices" (in EGP). */
  const [reduction, setReduction] = useState('');

  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [applyingAll, setApplyingAll] = useState(false);
  const [bulk, setBulk] = useState<BulkState | null>(null);

  /** What has been typed into a row's source URL field and not saved yet, by variant. */
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({});
  /** Why a row's source URL was refused, by variant. */
  const [linkErrors, setLinkErrors] = useState<Partial<Record<string, string>>>({});

  const [history, setHistory] = useState<HistoryView | null>(null);

  const [schedule, setSchedule] = useState<ScraperSchedule | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);

  const mounted = useRef(true);
  const requestSeq = useRef(0);
  const paramsRef = useRef<ScraperSearchParams>({});
  const bulkActive = useRef(false);
  const stopRequested = useRef(false);
  /**
   * What the last look at the schedule found (null before the first): a run changes what the rows show, so the list is
   * refreshed while a run goes, and once more when it is over, even if it began and ended between two looks.
   */
  const scheduleSeen = useRef<{ startedAt: string | null; running: boolean } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Whatever is still in flight answers into nothing, and a "scrape all" in progress stops after its current page.
      stopRequested.current = true;
      requestSeq.current += 1;
    };
  }, []);

  useEffect(() => {
    paramsRef.current = { search, state, sort, page, pageSize: ADMIN_PAGE_SIZE };
  });

  /** A silent load refreshes the rows in place: no spinner, and a failure leaves what is on screen alone. */
  const load = useCallback(
    async (params: ScraperSearchParams, silent = false): Promise<void> => {
      const requestId = requestSeq.current + 1;
      requestSeq.current = requestId;
      if (!silent) {
        setLoading(true);
        setListError(null);
      }
      try {
        const trimmed = params.search?.trim();
        const result = await adminApi.scraperRows({
          ...params,
          search: trimmed ? trimmed : undefined,
        });
        if (requestId !== requestSeq.current) {
          return;
        }
        setRows(result.rows);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setListError(null);
      } catch (error) {
        if (requestId !== requestSeq.current) {
          return;
        }
        const message = describeError(error);
        if (!silent) {
          // Never leave the previous page on screen next to an error.
          setRows([]);
          setTotal(0);
          setTotalPages(0);
          setListError(message);
        }
        showToast(message, 'error');
      } finally {
        if (requestId === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [describeError, showToast],
  );

  // The filter and the page are part of the request; a search waits for the typing to stop.
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        void load({ search, state, sort, page, pageSize: ADMIN_PAGE_SIZE });
      },
      search.trim().length > 0 ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [search, state, sort, page, load]);

  // Rows were removed from the last page by someone else: step back to the page that exists.
  useEffect(() => {
    if (!loading && rows.length === 0 && total > 0 && page > 1) {
      setPage(Math.max(1, totalPages));
    }
  }, [loading, rows.length, total, totalPages, page]);

  const replaceRow = useCallback((next: ScraperRow): void => {
    setRows((previous) => previous.map((row) => (row.variantId === next.variantId ? next : row)));
  }, []);

  const markBusy = useCallback((variantId: string, kind: BusyKind | null): void => {
    setBusy((previous) => {
      if (kind === null) {
        const { [variantId]: _finished, ...rest } = previous;
        return rest;
      }
      return { ...previous, [variantId]: kind };
    });
  }, []);

  const clearDraft = useCallback((variantId: string): void => {
    setDrafts((previous) => {
      const { [variantId]: _discarded, ...rest } = previous;
      return rest;
    });
    setLinkErrors((previous) => {
      const { [variantId]: _cleared, ...rest } = previous;
      return rest;
    });
  }, []);

  // ------------------------------------------------------------------------------------------------ the schedule

  /**
   * Reads the automatic run's schedule. While a run is going (and once more when it ends) the list is refreshed too,
   * because the run changes what the rows show.
   */
  const loadSchedule = useCallback(
    async (silent: boolean): Promise<void> => {
      try {
        const next = await adminApi.scraperSchedule();
        if (!mounted.current) {
          return;
        }
        setSchedule(next);
        setScheduleError(null);
        const startedAt = next.lastRun?.startedAtUtc ?? null;
        const running = next.lastRun !== null && next.lastRun.finishedAtUtc === null;
        const seen = scheduleSeen.current;
        if (running || (seen !== null && (seen.running || seen.startedAt !== startedAt))) {
          void load(paramsRef.current, true);
        }
        scheduleSeen.current = { startedAt, running };
      } catch (error) {
        if (mounted.current && !silent) {
          setScheduleError(describeError(error));
        }
      }
    },
    [describeError, load],
  );

  useEffect(() => {
    void loadSchedule(false);
  }, [loadSchedule]);

  const scheduledRunning = schedule?.lastRun != null && schedule.lastRun.finishedAtUtc === null;
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        void loadSchedule(true);
      },
      scheduledRunning ? SCHEDULE_POLL_RUNNING_MS : SCHEDULE_POLL_IDLE_MS,
    );
    return () => window.clearInterval(timer);
  }, [scheduledRunning, loadSchedule]);

  // The host looks at the schedule twice a minute, so a run starts within half a minute of its moment: look again just
  // after that, rather than leaving "next run" in the past until the next periodic look.
  const nextRunAtUtc = schedule?.nextRunAtUtc ?? null;
  useEffect(() => {
    if (nextRunAtUtc === null) {
      return undefined;
    }
    const delay = Date.parse(nextRunAtUtc) - Date.now() + SCHEDULE_START_LAG_MS;
    if (delay <= 0 || delay > MAX_TIMER_MS) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void loadSchedule(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [nextRunAtUtc, loadSchedule]);

  const openSchedule = (): void => {
    if (!schedule) {
      return;
    }
    setScheduleFormError(null);
    setScheduleDraft({ enabled: schedule.enabled, time: schedule.time || DEFAULT_SCHEDULE_TIME });
  };

  const saveSchedule = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!scheduleDraft) {
      return;
    }
    if (!CLOCK_TIME.test(scheduleDraft.time)) {
      setScheduleFormError(tr('Enter the time of day, for example 03:00.', 'أدخل وقت اليوم، مثل 03:00.'));
      return;
    }
    setScheduleSaving(true);
    setScheduleFormError(null);
    try {
      const saved = await adminApi.saveScraperSchedule(scheduleDraft);
      if (!mounted.current) {
        return;
      }
      setSchedule(saved);
      setScheduleDraft(null);
      showToast(
        saved.enabled
          ? tr(
              `Automatic scraping is on: every day at ${formatClock(saved.time, language)}.`,
              `السحب التلقائي يعمل: كل يوم الساعة ${formatClock(saved.time, language)}.`,
            )
          : tr('Automatic scraping is off.', 'تم إيقاف السحب التلقائي.'),
        'success',
      );
    } catch (error) {
      if (mounted.current) {
        setScheduleFormError(describeError(error));
      }
    } finally {
      if (mounted.current) {
        setScheduleSaving(false);
      }
    }
  };

  const locked = bulk?.running === true || applyingAll;

  const reductionAmount = Number(reduction);
  const reductionInvalid = !Number.isFinite(reductionAmount) || reductionAmount < 0;

  /** The reduction as a number of pounds; null (after saying why) when what was typed is not one. */
  const requireReduction = (): number | null => {
    if (reductionInvalid) {
      showToast(
        tr(
          'Enter the reduction as a number of pounds, for example 5 or 2.50.',
          'أدخل قيمة التخفيض كعدد من الجنيهات، مثل 5 أو 2.50.',
        ),
        'error',
      );
      return null;
    }
    return reductionAmount;
  };

  // ------------------------------------------------------------------------------------------------ one product

  const checkRow = async (row: ScraperRow): Promise<void> => {
    markBusy(row.variantId, 'check');
    try {
      const result = await adminApi.checkScraperPrice(row.variantId);
      if (!mounted.current) {
        return;
      }
      replaceRow(result.row);
      if (result.found && result.row.latest) {
        showToast(
          tr(
            `${row.sku}: read ${formatReadingPrice(result.row.latest, money, tr, language)}.`,
            `${row.sku}: تمت قراءة ${formatReadingPrice(result.row.latest, money, tr, language)}.`,
          ),
          'success',
        );
      } else {
        showToast(`${row.sku}: ${failureText(result.row, language) ?? result.message}`, 'info');
      }
    } catch (error) {
      if (mounted.current) {
        showToast(describeError(error), 'error');
        // The link may have been moved or removed by someone else meanwhile: show what is really stored.
        void load(paramsRef.current, true);
      }
    } finally {
      if (mounted.current) {
        markBusy(row.variantId, null);
      }
    }
  };

  const applyRow = async (row: ScraperRow): Promise<void> => {
    const decrease = requireReduction();
    if (decrease === null) {
      return;
    }
    if (row.latest === null) {
      return;
    }
    const reading = formatReadingPrice(row.latest, money, tr, language);
    const confirmed = window.confirm(
      decrease > 0
        ? tr(
            `Set ${row.sku} to the scraped price (${reading}) less ${money(decrease)}? It costs ${money(row.price)} now.`,
            `تعيين سعر ${row.sku} إلى السعر المسحوب (${reading}) مخصوماً منه ${money(decrease)}؟ سعره الحالي ${money(row.price)}.`,
          )
        : tr(
            `Set ${row.sku} to the scraped price (${reading})? It costs ${money(row.price)} now.`,
            `تعيين سعر ${row.sku} إلى السعر المسحوب (${reading})؟ سعره الحالي ${money(row.price)}.`,
          ),
    );
    if (!confirmed) {
      return;
    }

    markBusy(row.variantId, 'apply');
    try {
      const result = await adminApi.applyScraperPrice(row.variantId, decrease);
      if (!mounted.current) {
        return;
      }
      replaceRow(result.row);
      const { sku, previousPrice, newPrice } = result.applied;
      showToast(
        newPrice === previousPrice
          ? tr(`${sku} already costs ${money(newPrice)}.`, `${sku} سعره بالفعل ${money(newPrice)}.`)
          : tr(
              `${sku} now costs ${money(newPrice)} (it was ${money(previousPrice)}).`,
              `أصبح سعر ${sku} ${money(newPrice)} (كان ${money(previousPrice)}).`,
            ),
        'success',
      );
    } catch (error) {
      if (mounted.current) {
        showToast(describeError(error), 'error');
        // Someone else may have changed the price or the link: show what is really stored.
        void load(paramsRef.current, true);
      }
    } finally {
      if (mounted.current) {
        markBusy(row.variantId, null);
      }
    }
  };

  // ------------------------------------------------------------------------------------------------ the source URL

  const changeAddress = (row: ScraperRow, value: string): void => {
    setDrafts((previous) => ({ ...previous, [row.variantId]: value }));
    setLinkErrors((previous) => {
      const { [row.variantId]: _cleared, ...rest } = previous;
      return rest;
    });
  };

  const removeLink = async (row: ScraperRow): Promise<void> => {
    if (
      !window.confirm(
        tr(
          `Remove the source URL of ${row.sku}? The price scraped from that page is forgotten.`,
          `إزالة رابط المصدر لـ ${row.sku}؟ سيُنسى السعر المسحوب من تلك الصفحة.`,
        ),
      )
    ) {
      return;
    }
    markBusy(row.variantId, 'link');
    try {
      const result = await adminApi.removeScraperLink(row.variantId);
      if (!mounted.current) {
        return;
      }
      replaceRow(result.row);
      clearDraft(row.variantId);
      showToast(
        result.removed
          ? tr('The source URL was removed.', 'تمت إزالة رابط المصدر.')
          : tr('There was no source URL to remove.', 'لم يكن هناك رابط مصدر لإزالته.'),
        'success',
      );
      void load(paramsRef.current, true);
    } catch (error) {
      if (mounted.current) {
        showToast(describeError(error), 'error');
      }
    } finally {
      if (mounted.current) {
        markBusy(row.variantId, null);
      }
    }
  };

  /** Saves what was typed as the row's source URL; an emptied field removes it (after asking). */
  const saveAddress = async (row: ScraperRow): Promise<void> => {
    const typed = (drafts[row.variantId] ?? '').trim();
    if (typed === (row.url ?? '')) {
      return;
    }
    if (typed === '') {
      await removeLink(row);
      return;
    }
    markBusy(row.variantId, 'link');
    try {
      const result = await adminApi.setScraperLink(row.variantId, typed);
      if (!mounted.current) {
        return;
      }
      replaceRow(result.row);
      clearDraft(row.variantId);
      showToast(
        tr('The source URL was saved. Scrape the price to read it.', 'تم حفظ رابط المصدر. اسحب السعر لقراءته.'),
        'success',
      );
      void load(paramsRef.current, true);
    } catch (error) {
      if (mounted.current) {
        setLinkErrors((previous) => ({ ...previous, [row.variantId]: describeError(error) }));
      }
    } finally {
      if (mounted.current) {
        markBusy(row.variantId, null);
      }
    }
  };

  // ------------------------------------------------------------------------------------------------ the history

  const openHistory = async (row: ScraperRow): Promise<void> => {
    setHistory({ row, readings: null, error: null });
    try {
      const result = await adminApi.scraperHistory(row.variantId);
      if (!mounted.current) {
        return;
      }
      setHistory((current) =>
        current && current.row.variantId === row.variantId
          ? { row: result.row, readings: result.readings, error: null }
          : current,
      );
    } catch (error) {
      if (mounted.current) {
        setHistory((current) =>
          current && current.row.variantId === row.variantId ? { ...current, error: describeError(error) } : current,
        );
      }
    }
  };

  // ------------------------------------------------------------------------------------------------ all products

  const checkAll = async (): Promise<void> => {
    if (bulkActive.current || applyingAll) {
      return;
    }
    bulkActive.current = true;
    try {
      let targets: ScraperTarget[];
      try {
        targets = await adminApi.scraperTargets();
      } catch (error) {
        if (mounted.current) {
          showToast(describeError(error), 'error');
        }
        return;
      }
      if (!mounted.current) {
        return;
      }
      if (targets.length === 0) {
        setBulk({ running: false, stopping: false, total: 0, done: 0, found: 0, without: 0, current: null, stopped: false, error: null });
        return;
      }
      const count = targets.length;
      if (
        !window.confirm(
          tr(
            `Scrape the price of ${countPages(count, tr)} one after another? Each takes a few seconds, some shops take longer, and you can stop at any time.`,
            `سحب الأسعار من ${countPages(count, tr)} واحدة بعد الأخرى؟ تستغرق كل صفحة بضع ثوانٍ وبعض المتاجر أطول، ويمكنك الإيقاف في أي وقت.`,
          ),
        )
      ) {
        return;
      }

      stopRequested.current = false;
      const progress = { done: 0, found: 0, without: 0, error: null as string | null };

      for (let index = 0; index < count; index += 1) {
        if (stopRequested.current || !mounted.current) {
          break;
        }
        const target = targets[index];
        setBulk({
          ...progress,
          running: true,
          stopping: false,
          total: count,
          current: target.label,
          stopped: false,
        });
        try {
          const result = await adminApi.checkScraperPrice(target.variantId);
          if (!mounted.current) {
            return;
          }
          replaceRow(result.row);
          if (result.found) {
            progress.found += 1;
          } else {
            progress.without += 1;
          }
        } catch (failure) {
          if (!mounted.current) {
            return;
          }
          progress.without += 1;
          if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
            progress.error = describeError(failure);
            progress.done += 1;
            break;
          }
        }
        progress.done += 1;
        if (index < count - 1 && !stopRequested.current) {
          // The shops are other people's servers: one page at a time, with a pause in between. (The app's TypeScript
          // lib is ES2022, which has no Promise.withResolvers.)
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, PAUSE_BETWEEN_CHECKS_MS);
          });
        }
      }

      if (!mounted.current) {
        return;
      }
      setBulk({ ...progress, running: false, stopping: false, total: count, current: null, stopped: stopRequested.current });
      // The order and the filters depend on what the scrape found.
      void load(paramsRef.current, true);
    } finally {
      bulkActive.current = false;
    }
  };

  const stopChecking = (): void => {
    stopRequested.current = true;
    setBulk((current) => (current ? { ...current, stopping: true } : current));
  };

  const applyAll = async (): Promise<void> => {
    const decrease = requireReduction();
    if (decrease === null) {
      return;
    }
    const confirmed = window.confirm(
      tr(
        `Set every product to its scraped price${decrease > 0 ? `, less ${money(decrease)}` : ''}? Only recent prices in EGP that were not applied yet are used, and a price that would move by more than half is left alone.`,
        `تعيين سعر كل منتج إلى سعره المسحوب${decrease > 0 ? `، مخصوماً منه ${money(decrease)}` : ''}؟ تُستخدم فقط الأسعار الحديثة بالجنيه التي لم تُطبَّق بعد، ويُترك أي سعر سيتغير بأكثر من النصف.`,
      ),
    );
    if (!confirmed) {
      return;
    }

    setApplyingAll(true);
    try {
      const summary = await adminApi.applyAllScraperPrices(decrease);
      if (!mounted.current) {
        return;
      }
      const touched = summary.applied + summary.unchanged;
      if (touched + summary.skipped.length === 0) {
        showToast(
          tr(
            'Nothing to apply: no product has a recent scraped price in EGP that has not been applied yet. Scrape the pages first.',
            'لا يوجد ما يُطبَّق: لا يوجد منتج له سعر مسحوب حديث بالجنيه لم يُطبَّق بعد. اسحب الأسعار أولاً.',
          ),
          'info',
        );
      }
      if (touched > 0) {
        showToast(
          tr(
            `${summary.applied} price${summary.applied === 1 ? '' : 's'} applied${summary.unchanged > 0 ? `; ${summary.unchanged} already had that price.` : '.'}`,
            `تم تطبيق ${summary.applied} سعر${summary.unchanged > 0 ? `؛ و${summary.unchanged} كان سعرها كذلك بالفعل.` : '.'}`,
          ),
          'success',
        );
      }
      if (summary.skipped.length > 0) {
        const shown = summary.skipped.slice(0, 5);
        const more = summary.skipped.length - shown.length;
        showToast(
          tr(
            `${summary.skipped.length} product${summary.skipped.length === 1 ? '' : 's'} left alone. ${shown.map((entry) => `${entry.sku}: ${entry.reason}`).join('; ')}${more > 0 ? ` And ${more} more.` : ''}`,
            `تُرك ${summary.skipped.length} منتج دون تغيير: ${shown.map((entry) => entry.sku).join('، ')}${more > 0 ? ` و${more} أخرى` : ''}.`,
          ),
          'info',
        );
      }
      void load(paramsRef.current, true);
    } catch (error) {
      if (mounted.current) {
        showToast(describeError(error), 'error');
      }
    } finally {
      if (mounted.current) {
        setApplyingAll(false);
      }
    }
  };

  // ------------------------------------------------------------------------------------------------ rendering

  const progressPercent = bulk && bulk.total > 0 ? Math.round((bulk.done / bulk.total) * 100) : 0;

  const bulkSummary = (current: BulkState): string => {
    if (current.total === 0) {
      return tr(
        "No product has a source URL yet. Paste the other shop's product page address on a row first.",
        'لا يوجد منتج له رابط مصدر بعد. الصق عنوان صفحة المنتج في المتجر الآخر في أحد الصفوف أولاً.',
      );
    }
    return [
      tr(
        `Scraped ${current.done} of ${current.total}: ${current.found} with a price, ${current.without} without.`,
        `تم سحب ${current.done} من ${current.total}: ${current.found} بسعر و${current.without} بدون سعر.`,
      ),
      current.stopped ? tr('Stopped.', 'تم الإيقاف.') : null,
      current.error,
    ]
      .filter((part): part is string => part !== null)
      .join(' ');
  };

  const changeSearch = (value: string): void => {
    setSearch(value);
    setPage(1);
  };

  const columnCount = 6;

  return (
    <div className="space-y-4" data-panel="scraper">
      <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 shadow-xs space-y-4">
        <div className="pb-3 border-b border-[#F0E3DF] flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#FAF3F1] text-[#8B263E] flex items-center justify-center shrink-0">
            <Radar className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-bold text-sm text-[#2D1E2F]">{tr('Price scraper', 'مقارنة الأسعار')}</h3>
            <p className="text-xs text-[#8B6E7E]">
              {tr(
                "Every product is listed here. Paste the address of the same product's page at another shop (the source URL), scrape its price, compare it with ours, and apply it if you want to match or undercut it.",
                'كل المنتجات مدرجة هنا. الصق عنوان صفحة المنتج نفسه في متجر آخر (رابط المصدر)، ثم اسحب سعره وقارنه بسعرنا، وطبّقه إذا أردت مطابقته أو تخفيضه.',
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <label className="block">
            <span className="block font-bold mb-1">{tr('Search', 'بحث')}</span>
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                aria-label={tr('Search products by SKU, name or shade', 'ابحث في المنتجات بالكود أو الاسم أو الدرجة')}
                placeholder={tr('SKU, product or shade...', 'SKU أو المنتج أو الدرجة...')}
                maxLength={100}
                autoComplete="off"
                className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl py-2 px-9 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5 rtl:left-auto rtl:right-3" aria-hidden="true" />
            </div>
          </label>

          <label className="block">
            <span className="block font-bold mb-1">{tr('Show', 'عرض')}</span>
            <select
              value={state}
              onChange={(event) => {
                setState(event.target.value as ScraperState);
                setPage(1);
              }}
              className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 font-semibold"
            >
              {STATES.map((option) => (
                <option key={option} value={option}>
                  {l(STATE_LABEL[option])}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block font-bold mb-1">{tr('Sort by', 'ترتيب حسب')}</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as ScraperSort);
                setPage(1);
              }}
              className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 font-semibold"
            >
              {SORTS.map((option) => (
                <option key={option} value={option}>
                  {l(SORT_LABEL[option])}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 pt-3 border-t border-[#F0E3DF] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action="check-all"
              onClick={() => void checkAll()}
              disabled={locked}
              className="px-4 py-2 bg-[#3B2332] text-white rounded-xl font-bold hover:bg-[#523347] transition flex items-center gap-1.5 disabled:opacity-60"
            >
              {bulk?.running ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {tr('Scrape all prices', 'سحب كل الأسعار')}
            </button>
            {bulk?.running && (
              <button
                type="button"
                data-action="stop-checking"
                onClick={stopChecking}
                disabled={bulk.stopping}
                className="px-4 py-2 border border-[#E8D6D1] rounded-xl font-bold hover:bg-[#F3E7E4] transition flex items-center gap-1.5 disabled:opacity-60"
              >
                <Square className="w-3.5 h-3.5" aria-hidden="true" />
                {tr('Stop', 'إيقاف')}
              </button>
            )}
            <button
              type="button"
              data-action="schedule"
              onClick={openSchedule}
              disabled={schedule === null}
              title={tr('Scrape automatically at a time of day', 'السحب تلقائياً في وقت محدد من اليوم')}
              className="px-4 py-2 border border-[#E8D6D1] rounded-xl font-bold hover:bg-[#F3E7E4] transition flex items-center gap-1.5 disabled:opacity-60"
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {tr('Schedule', 'جدولة')}
              {schedule?.enabled && (
                <span
                  className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px]"
                  dir="ltr"
                  data-field="schedule-badge"
                >
                  {formatClock(schedule.time, language)}
                </span>
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block font-bold mb-1">{tr('Reduce each price by (EGP)', 'خفّض كل سعر بمقدار (EGP)')}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={reduction}
                onChange={(event) => setReduction(event.target.value)}
                aria-invalid={reductionInvalid}
                placeholder="0"
                data-field="reduction"
                className={`w-36 bg-[#FAF7F5] border rounded-xl py-2 px-3 text-xs ${
                  reductionInvalid ? 'border-rose-400' : 'border-[#E8D6D1]'
                }`}
              />
            </label>
            <button
              type="button"
              data-action="apply-all"
              onClick={() => void applyAll()}
              disabled={locked}
              className="px-4 py-2 bg-[#8B263E] text-white rounded-xl font-bold hover:bg-[#721f32] transition flex items-center gap-1.5 disabled:opacity-60"
            >
              {applyingAll && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {tr('Apply all prices', 'تطبيق كل الأسعار')}
            </button>
          </div>
        </div>

        {bulk && (
          <div className="space-y-1.5" data-field="progress">
            <div
              role="progressbar"
              aria-label={tr('Pages scraped', 'الصفحات المسحوبة')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
              className="h-2 rounded-full bg-[#F0E3DF] overflow-hidden"
            >
              <div className="h-full bg-[#3B2332] transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <p role="status" aria-live="polite" className="text-[11px] text-[#8B6E7E]">
              {bulk.running ? (
                <>
                  {bulk.stopping ? tr('Stopping after this page... ', 'سيتوقف بعد هذه الصفحة... ') : null}
                  {tr('Scraping', 'جارٍ سحب')}{' '}
                  <bdi dir="ltr" className="font-mono">
                    {bulk.current}
                  </bdi>{' '}
                  ({bulk.done + 1} {tr('of', 'من')} {bulk.total})
                </>
              ) : (
                bulkSummary(bulk)
              )}
            </p>
          </div>
        )}

        <div className="space-y-0.5 text-[11px] text-[#8B6E7E]" data-field="schedule-status">
          {schedule === null ? (
            scheduleError ? (
              <p role="alert" className="text-rose-700 flex flex-wrap items-center gap-2">
                <span>{scheduleError}</span>
                <button
                  type="button"
                  onClick={() => void loadSchedule(false)}
                  className="px-2 py-0.5 border border-rose-200 rounded-lg font-bold hover:bg-rose-50"
                >
                  {tr('Retry', 'إعادة المحاولة')}
                </button>
              </p>
            ) : (
              <p>{tr('Loading the schedule...', 'جارٍ تحميل الجدولة...')}</p>
            )
          ) : (
            <>
              <p data-field="schedule-line">
                {schedule.enabled && schedule.nextRunAtUtc !== null
                  ? tr(
                      `Automatic scraping is on: every day at ${formatClock(schedule.time, language)} (${zoneLabel(schedule.timeZone, tr)}). Next run: ${formatShopMoment(schedule.nextRunAtUtc, language, schedule.timeZone)}.`,
                      `السحب التلقائي يعمل: كل يوم الساعة ${formatClock(schedule.time, language)} (${zoneLabel(schedule.timeZone, tr)}). التشغيل القادم: ${formatShopMoment(schedule.nextRunAtUtc, language, schedule.timeZone)}.`,
                    )
                  : tr('Automatic scraping is off.', 'السحب التلقائي متوقف.')}
              </p>
              {schedule.lastRun && (
                <p data-field="schedule-last-run">{runSummary(schedule.lastRun, schedule.timeZone, language, tr)}</p>
              )}
            </>
          )}
        </div>

        <p className="text-[11px] text-[#8B6E7E]" data-field="scraper-count">
          {tr(
            `Showing ${rows.length} of ${total} products (page ${page} of ${Math.max(1, totalPages)}).`,
            `عرض ${rows.length} من ${total} منتج (الصفحة ${page} من ${Math.max(1, totalPages)}).`,
          )}
        </p>
      </div>

      {listError && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-900 flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
            <span>{listError}</span>
          </span>
          <button
            type="button"
            onClick={() => void load({ search, state, sort, page, pageSize: ADMIN_PAGE_SIZE })}
            className="px-3 py-1.5 bg-white border border-rose-200 rounded-lg font-bold flex items-center gap-1.5 hover:bg-rose-100"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {tr('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-[#E8D6D1] overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead>
              <tr className="bg-[#FAF7F5] border-b border-[#E8D6D1] text-[#8B6E7E] uppercase text-[10px]">
                <th className="py-3 px-3 text-start">{tr('Product', 'المنتج')}</th>
                <th className="py-3 px-3 text-start">{tr('Source page URL', 'رابط صفحة المصدر')}</th>
                <th className="py-3 px-3 text-start">{tr('Current price', 'السعر الحالي')}</th>
                <th className="py-3 px-3 text-start">{tr('Scraped price', 'السعر المسحوب')}</th>
                <th className="py-3 px-3 text-start">{tr('Gap', 'الفرق')}</th>
                <th className="py-3 px-3 text-end">{tr('Actions', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3E7E4]">
              {loading ? (
                <tr>
                  <td colSpan={columnCount} className="py-10 text-center text-[#8B6E7E]">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" aria-hidden="true" />
                    {tr('Loading products...', 'جارٍ تحميل المنتجات...')}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                !listError && (
                  <tr>
                    <td colSpan={columnCount} className="py-12 text-center text-[#8B6E7E] space-y-2" data-empty="scraper">
                      <Radar className="w-8 h-8 mx-auto text-[#D4A29C]" aria-hidden="true" />
                      <p className="font-bold text-[#2D1E2F]">{tr('No products match.', 'لا توجد منتجات مطابقة.')}</p>
                      <p>{tr('Try another search or filter.', 'جرّب بحثاً أو تصفية أخرى.')}</p>
                    </td>
                  </tr>
                )
              ) : (
                rows.map((row) => {
                  const rowBusy = busy[row.variantId];
                  const draft = drafts[row.variantId];
                  const address = draft ?? row.url ?? '';
                  const dirty = draft !== undefined && draft.trim() !== (row.url ?? '');
                  const addressError = linkErrors[row.variantId];
                  const frozen = locked || rowBusy !== undefined;
                  // Only a web address is ever made into a link.
                  const href = row.url !== null && /^https?:\/\//i.test(row.url) ? row.url : null;
                  const blocked = applyBlockedReason(row, tr);
                  const failure = failureText(row, language);
                  const latest = row.latest;
                  const cannotScrape =
                    row.url === null
                      ? tr('Add a source URL first', 'أضف رابط مصدر أولاً')
                      : dirty
                        ? tr('Save the source URL first', 'احفظ رابط المصدر أولاً')
                        : undefined;
                  return (
                    <tr
                      key={row.variantId}
                      data-scraper-row={row.variantId}
                      data-scraper-sku={row.sku}
                      className="hover:bg-[#FAF7F5] align-top"
                    >
                      <td className="py-3 px-3 min-w-[13rem]">
                        <div className="flex items-start gap-3">
                          {row.imageUrl ? (
                            <img
                              src={mediaUrl(row.imageUrl)}
                              alt={l(row.productName)}
                              loading="lazy"
                              className="w-10 h-10 object-cover rounded-lg border border-[#E8D6D1] shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg border border-[#E8D6D1] bg-[#FAF7F5] flex items-center justify-center text-[#B49AA6] shrink-0">
                              <ImageIcon className="w-4 h-4" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-bold text-[#2D1E2F] break-words">{l(row.productName)}</p>
                            <p className="text-[11px] text-[#8B6E7E]">
                              {[row.shade ? l(row.shade) : null, row.size].filter(Boolean).join(' • ')}
                            </p>
                            <p className="text-[10px] font-mono text-[#B49AA6]" dir="ltr">
                              {row.sku}
                            </p>
                            {!row.variantActive && (
                              <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-stone-200 text-stone-800 text-[10px] font-bold">
                                {tr('Inactive', 'غير نشط')}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 min-w-[16rem] w-[20rem]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="url"
                            dir="ltr"
                            value={address}
                            onChange={(event) => changeAddress(row, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void saveAddress(row);
                              } else if (event.key === 'Escape' && draft !== undefined) {
                                event.preventDefault();
                                clearDraft(row.variantId);
                              }
                            }}
                            placeholder="https://..."
                            maxLength={2000}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={frozen}
                            aria-label={`${tr('Source page URL', 'رابط صفحة المصدر')}: ${row.sku}`}
                            aria-invalid={addressError !== undefined}
                            data-field="source-url"
                            className={`min-w-0 flex-1 bg-[#FAF7F5] border rounded-lg py-1.5 px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E] disabled:opacity-60 ${
                              addressError !== undefined ? 'border-rose-400' : 'border-[#E8D6D1]'
                            }`}
                          />
                          {dirty ? (
                            <>
                              <button
                                type="button"
                                data-action="save-link"
                                onClick={() => void saveAddress(row)}
                                disabled={frozen}
                                aria-label={`${tr('Save the source URL', 'حفظ رابط المصدر')}: ${row.sku}`}
                                title={tr('Save the source URL', 'حفظ رابط المصدر')}
                                className="p-1.5 bg-[#3B2332] text-white rounded-lg hover:bg-[#523347] transition disabled:opacity-50"
                              >
                                {rowBusy === 'link' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                              </button>
                              <button
                                type="button"
                                data-action="discard-link"
                                onClick={() => clearDraft(row.variantId)}
                                disabled={frozen}
                                aria-label={`${tr('Discard the change', 'تجاهل التعديل')}: ${row.sku}`}
                                title={tr('Discard the change', 'تجاهل التعديل')}
                                className="p-1.5 hover:bg-[#F3E7E4] rounded-lg text-[#3B2332] transition disabled:opacity-50"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </>
                          ) : (
                            row.url !== null && (
                              <>
                                {href && (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={tr('Open the source page', 'فتح صفحة المصدر')}
                                    className="relative p-1.5 hover:bg-[#F3E7E4] rounded-lg text-[#8B263E] transition"
                                    data-action="open-link"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span className="sr-only">
                                      {tr('Open the source page', 'فتح صفحة المصدر')} {row.sku}{' '}
                                      {tr('(opens in a new tab)', '(يفتح في تبويب جديد)')}
                                    </span>
                                  </a>
                                )}
                                <button
                                  type="button"
                                  data-action="remove-link"
                                  onClick={() => void removeLink(row)}
                                  disabled={frozen}
                                  aria-label={`${tr('Remove the source URL', 'إزالة رابط المصدر')}: ${row.sku}`}
                                  title={tr('Remove the source URL', 'إزالة رابط المصدر')}
                                  className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition disabled:opacity-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </>
                            )
                          )}
                        </div>
                        {addressError !== undefined && (
                          <p role="alert" className="mt-1 text-[11px] text-rose-700" data-field="source-url-error">
                            {addressError}
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-3 font-bold text-[#8B263E] whitespace-nowrap" data-field="current-price">
                        {money(row.price)}
                      </td>

                      <td className="py-3 px-3 min-w-[11rem] max-w-[16rem] space-y-1">
                        {row.url === null ? (
                          <span className="text-[#B49AA6]" data-field="scraped-price" title={tr('No source URL yet', 'لا يوجد رابط مصدر بعد')}>
                            —
                          </span>
                        ) : (
                          <>
                            {latest ? (
                              <div data-field="reading" className="space-y-0.5">
                                <p className="font-bold text-[#2D1E2F]" data-field="scraped-price">
                                  {formatReadingPrice(latest, money, tr, language)}
                                </p>
                                {latest.title && (
                                  <p className="text-[11px] text-[#8B6E7E] truncate" dir="auto" title={latest.title}>
                                    {latest.title}
                                  </p>
                                )}
                                <p className="text-[11px] text-[#8B6E7E]">
                                  {tr('Read', 'قُرئ')} {formatMoment(latest.readAtUtc, language)}،{' '}
                                  {latest.engine === 'browser'
                                    ? tr('with a browser', 'بمتصفح')
                                    : tr('with a plain request', 'بطلب عادي')}
                                </p>
                                {latest.appliedPrice !== null && latest.appliedAtUtc !== null && (
                                  <p className="text-[11px] text-emerald-800">
                                    {tr('Applied as', 'طُبّق بسعر')} {money(latest.appliedPrice)} {tr('on', 'في')}{' '}
                                    {formatMoment(latest.appliedAtUtc, language)}
                                  </p>
                                )}
                                {blocked && <p className="text-[11px] text-amber-700">{blocked}</p>}
                              </div>
                            ) : (
                              !failure && (
                                <p className="text-[#8B6E7E]" data-field="not-scraped">
                                  {tr('Not scraped yet.', 'لم يُسحب بعد.')}
                                </p>
                              )
                            )}

                            {failure && (
                              <div data-field="error" className="space-y-0.5">
                                <p className="text-rose-700 font-medium">{failure}</p>
                                {row.lastCheckedAtUtc && (
                                  <p className="text-[11px] text-[#8B6E7E]">
                                    {tr('Last attempt', 'آخر محاولة')} {formatMoment(row.lastCheckedAtUtc, language)}
                                  </p>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <GapBadge gap={row.gap} language={language} tr={tr} />
                      </td>

                      <td className="py-3 px-3 text-end">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span title={cannotScrape}>
                            <button
                              type="button"
                              data-action="check"
                              onClick={() => void checkRow(row)}
                              disabled={row.url === null || dirty || frozen}
                              className="px-3 py-1.5 bg-[#3B2332] text-white rounded-lg font-bold hover:bg-[#523347] transition flex items-center gap-1.5 disabled:opacity-50"
                            >
                              {rowBusy === 'check' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              {tr('Scrape price', 'سحب السعر')}
                            </button>
                          </span>
                          <span title={blocked ?? undefined}>
                            <button
                              type="button"
                              data-action="apply"
                              onClick={() => void applyRow(row)}
                              disabled={!row.canApply || frozen}
                              className="px-3 py-1.5 bg-[#8B263E] text-white rounded-lg font-bold hover:bg-[#721f32] transition flex items-center gap-1.5 disabled:opacity-40"
                            >
                              {rowBusy === 'apply' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                              {tr('Apply', 'تطبيق')}
                            </button>
                          </span>
                          <button
                            type="button"
                            data-action="history"
                            onClick={() => void openHistory(row)}
                            aria-label={`${tr('Price history', 'سجل الأسعار')}: ${row.sku}`}
                            title={tr('Price history', 'سجل الأسعار')}
                            className="p-1.5 hover:bg-[#F3E7E4] rounded-lg text-[#3B2332] transition"
                          >
                            <HistoryIcon className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AdminPagination
        id="scraper"
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={ADMIN_PAGE_SIZE}
        onPage={setPage}
        disabled={loading}
      />

      {scheduleDraft && schedule && (
        <AdminModal
          title={tr('Automatic scraping', 'السحب التلقائي')}
          closeLabel={tr('Close', 'إغلاق')}
          onClose={() => setScheduleDraft(null)}
          widthClass="max-w-lg"
        >
          <form
            onSubmit={(event) => void saveSchedule(event)}
            noValidate
            className="space-y-4 text-xs"
            data-form="scraper-schedule"
          >
            {scheduleFormError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{scheduleFormError}</span>
              </div>
            )}

            <p className="text-[#503E48]">
              {tr(
                'At the time you choose, the server scrapes every product that has a source URL by itself, even when nobody is signed in. It only reads prices: nothing in your shop changes until you apply a price.',
                'في الوقت الذي تختاره، يسحب الخادم أسعار كل منتج له رابط مصدر تلقائياً، حتى لو لم يكن أحد مسجلاً الدخول. هو يقرأ الأسعار فقط: لا يتغير شيء في متجرك حتى تطبّق سعراً.',
              )}
            </p>

            <label className="flex items-center gap-2 font-bold">
              <input
                type="checkbox"
                checked={scheduleDraft.enabled}
                onChange={(event) =>
                  setScheduleDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))
                }
                data-field="schedule-enabled"
                className="w-4 h-4 accent-[#8B263E]"
              />
              {tr('Scrape automatically every day', 'السحب تلقائياً كل يوم')}
            </label>

            <div>
              <label htmlFor={scheduleTimeId} className="block font-bold mb-1">
                {tr('Time of day', 'وقت اليوم')}
              </label>
              <input
                id={scheduleTimeId}
                type="time"
                step={60}
                dir="ltr"
                value={scheduleDraft.time}
                onChange={(event) =>
                  setScheduleDraft((current) => (current ? { ...current, time: event.target.value } : current))
                }
                aria-describedby={scheduleHintId}
                data-field="schedule-time"
                className="bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 font-semibold"
              />
              <p id={scheduleHintId} className="text-[10px] text-[#8B6E7E] mt-1">
                {tr(
                  `On the shop's clock (${zoneLabel(schedule.timeZone, tr)}). Pages are read one at a time, so a long list takes a while to finish.`,
                  `بتوقيت المتجر (${zoneLabel(schedule.timeZone, tr)}). تُقرأ الصفحات واحدة تلو الأخرى، لذا قد تستغرق القائمة الطويلة بعض الوقت.`,
                )}
              </p>
            </div>

            <div className="rounded-xl bg-[#FAF7F5] border border-[#F0E3DF] p-3 space-y-1 text-[11px] text-[#503E48]">
              <p data-field="schedule-next">
                <span className="font-bold">{tr('Next run', 'التشغيل القادم')}:</span>{' '}
                {schedule.enabled && schedule.nextRunAtUtc !== null
                  ? formatShopMoment(schedule.nextRunAtUtc, language, schedule.timeZone)
                  : tr('none, automatic scraping is off', 'لا يوجد، السحب التلقائي متوقف')}
              </p>
              <p data-field="schedule-previous">
                <span className="font-bold">{tr('Last run', 'آخر تشغيل')}:</span>{' '}
                {schedule.lastRun
                  ? runSummary(schedule.lastRun, schedule.timeZone, language, tr)
                  : tr('it has not run yet', 'لم يعمل بعد')}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#E8D6D1]">
              <button
                type="button"
                onClick={() => setScheduleDraft(null)}
                className="px-5 py-2.5 border border-[#E8D6D1] rounded-xl font-bold"
              >
                {tr('Cancel', 'إلغاء')}
              </button>
              <button
                type="submit"
                disabled={scheduleSaving}
                className="px-6 py-2.5 bg-[#3B2332] text-white rounded-xl font-bold hover:bg-[#523347] transition flex items-center gap-2 disabled:opacity-60"
              >
                {scheduleSaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {tr('Save schedule', 'حفظ الجدولة')}
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {history && (
        <AdminModal
          title={`${tr('Price history', 'سجل الأسعار')}: ${history.row.sku}`}
          closeLabel={tr('Close', 'إغلاق')}
          onClose={() => setHistory(null)}
          widthClass="max-w-4xl"
        >
          <div className="space-y-3 text-xs" data-panel="scraper-history">
            <p className="text-[#503E48]">
              <span className="font-bold">{l(history.row.productName)}</span>{' '}
              <span className="text-[#8B6E7E]">
                {tr('We charge', 'سعرنا')} {money(history.row.price)}
              </span>
            </p>

            {history.error ? (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{history.error}</span>
              </div>
            ) : history.readings === null ? (
              <p className="py-6 text-center text-[#8B6E7E]">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" aria-hidden="true" />
                {tr('Loading history...', 'جارٍ تحميل السجل...')}
              </p>
            ) : history.readings.length === 0 ? (
              <p className="py-6 text-center text-[#8B6E7E]">{tr('No price has been scraped yet.', 'لم تُسحب أي أسعار بعد.')}</p>
            ) : (
              <>
                <p className="text-[11px] text-[#8B6E7E]">
                  {tr('The newest readings are shown first.', 'تظهر أحدث القراءات أولاً.')}
                </p>
                <div className="overflow-x-auto border border-[#E8D6D1] rounded-2xl">
                  <table className="w-full text-start text-xs">
                    <thead>
                      <tr className="bg-[#FAF7F5] border-b border-[#E8D6D1] text-[#8B6E7E] uppercase text-[10px]">
                        <th className="py-2.5 px-3 text-start">{tr('Read at', 'وقت القراءة')}</th>
                        <th className="py-2.5 px-3 text-start">{tr('Price', 'السعر')}</th>
                        <th className="py-2.5 px-3 text-start">{tr('Found in', 'مصدر السعر')}</th>
                        <th className="py-2.5 px-3 text-start">{tr('How it was read', 'طريقة القراءة')}</th>
                        <th className="py-2.5 px-3 text-start">{tr('Page title', 'عنوان الصفحة')}</th>
                        <th className="py-2.5 px-3 text-start">{tr('Applied', 'التطبيق')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3E7E4]">
                      {history.readings.map((reading) => (
                        <tr key={reading.id} data-reading={reading.id} className="align-top">
                          <td className="py-2.5 px-3 whitespace-nowrap">{formatMoment(reading.readAtUtc, language)}</td>
                          <td className="py-2.5 px-3 font-bold whitespace-nowrap">
                            {formatReadingPrice(reading, money, tr, language)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]" dir="ltr">
                            {reading.strategy}
                          </td>
                          <td className="py-2.5 px-3">
                            {reading.engine === 'browser' ? tr('Browser', 'متصفح') : tr('Plain request', 'طلب عادي')}
                          </td>
                          <td className="py-2.5 px-3 max-w-[16rem] break-words" dir="auto">
                            {reading.title ?? '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {reading.appliedPrice !== null && reading.appliedAtUtc !== null
                              ? `${money(reading.appliedPrice)} · ${formatMoment(reading.appliedAtUtc, language)}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </AdminModal>
      )}
    </div>
  );
};
