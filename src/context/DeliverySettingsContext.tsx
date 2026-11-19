import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { catalogApi } from '../api/api';
import { DEFAULT_FREE_SHIPPING_THRESHOLD, DEFAULT_SHIPPING_FEE } from '../utils/shopLogic';

interface DeliverySettingsState {
  deliveryFee: number;
  freeShippingThreshold: number;
  /** False until the server's current terms have arrived (or if they could not be read). */
  loaded: boolean;
  /** Re-reads the terms, e.g. after an administrator saves them. */
  refresh: () => void;
}

const DeliverySettingsContext = createContext<DeliverySettingsState | undefined>(undefined);

export const DeliverySettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState({
    deliveryFee: DEFAULT_SHIPPING_FEE,
    freeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
    loaded: false,
  });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refresh = useCallback(() => setRefreshNonce((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    catalogApi
      .deliverySettings()
      .then((current) => {
        if (active) {
          setSettings({
            deliveryFee: current.deliveryFee,
            freeShippingThreshold: current.freeShippingThreshold,
            loaded: true,
          });
        }
      })
      .catch(() => {
        // The defaults keep the cart and the announcement useful; a quote always carries the server's figures.
      });

    return () => {
      active = false;
    };
  }, [refreshNonce]);

  return (
    <DeliverySettingsContext.Provider value={{ ...settings, refresh }}>
      {children}
    </DeliverySettingsContext.Provider>
  );
};

export function useDeliverySettings(): DeliverySettingsState {
  const value = useContext(DeliverySettingsContext);
  if (!value) {
    throw new Error('useDeliverySettings must be used inside DeliverySettingsProvider');
  }
  return value;
}
