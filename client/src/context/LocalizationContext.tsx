import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchLocalizationContext } from "../adminApi";

type LocalizationContextType = {
  activeEntity: any | null;
  metadata: any | null;
  invoiceFields: string[];
  features: Record<string, boolean>;
  isLoading: boolean;
  refreshContext: () => Promise<void>;
};

const LocalizationContext = createContext<LocalizationContextType>({
  activeEntity: null,
  metadata: null,
  invoiceFields: [],
  features: {},
  isLoading: true,
  refreshContext: async () => {},
});

export function LocalizationProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Partial<LocalizationContextType>>({});
  const [isLoading, setIsLoading] = useState(true);

  const refreshContext = async () => {
    setIsLoading(true);
    try {
      const res: any = await fetchLocalizationContext();
      setData({
        activeEntity: res.activeEntity,
        metadata: res.metadata,
        invoiceFields: res.invoiceFields || [],
        features: res.features || {},
      });
    } catch (e) {
      console.error("Failed to load localization context", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshContext();
  }, []);

  return (
    <LocalizationContext.Provider
      value={{
        activeEntity: data.activeEntity || null,
        metadata: data.metadata || null,
        invoiceFields: data.invoiceFields || [],
        features: data.features || {},
        isLoading,
        refreshContext,
      }}
    >
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  return useContext(LocalizationContext);
}
