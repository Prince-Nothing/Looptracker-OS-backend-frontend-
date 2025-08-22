'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Toast, type ToastVariant } from './Toast';

type ToastItem = {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms
  actionLabel?: string;
  onAction?: () => void;
};

type ToastApi = {
  push: (t: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string, opts?: Partial<Omit<ToastItem,'title'|'description'|'variant'>>) => string;
  error: (title: string, description?: string, opts?: Partial<Omit<ToastItem,'title'|'description'|'variant'>>) => string;
  info: (title: string, description?: string, opts?: Partial<Omit<ToastItem,'title'|'description'|'variant'>>) => string;
  warning: (title: string, description?: string, opts?: Partial<Omit<ToastItem,'title'|'description'|'variant'>>) => string;
};

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToasterProvider>');
  }
  return ctx;
}

export const ToasterProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = React.useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    const duration = t.duration ?? 3200;
    setToasts((xs) => [...xs, { ...t, id }]);
    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const mk = (variant: ToastVariant) =>
    (title: string, description?: string, opts?: Partial<Omit<ToastItem,'title'|'description'|'variant'>>) =>
      push({ title, description, variant, ...(opts ?? {}) });

  const api: ToastApi = React.useMemo(
    () => ({
      push,
      dismiss,
      success: mk('success'),
      error: mk('error'),
      info: mk('info'),
      warning: mk('warning'),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
            {toasts.map((t) => (
              <Toast
                key={t.id}
                title={t.title}
                description={t.description}
                variant={t.variant}
                onClose={() => dismiss(t.id)}
                actionLabel={t.actionLabel}
                onAction={t.onAction}
                className="shadow-2xl"
              />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
};
