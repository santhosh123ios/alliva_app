import { api } from '@/components/providers';
import { beginCartChange, bumpCart, cartChangesPending, cartQueryKey, cartQueryOptions, failCartChange, settleCartChange, type CartAddInput, type CartSnapshot } from '@/lib/cart-cache';
import { pickLocalized } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { toast } from 'sonner';

type StoreName = { en?: string; ar?: string } | null | undefined;

type AddBody = CartAddInput & {
  merchantName?: StoreName;
};

type Prompt = {
  currentStore: string;
  nextStore: string;
  body: AddBody;
};

export function useCartAdd() {
  const client = useQueryClient();
  const locale = useLocale() as 'en' | 'ar';
  const t = useTranslations();
  const cart = useQuery(cartQueryOptions());
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const add = useMutation({
    mutationFn: async (input: AddBody) => {
      await api.guest().catch(() => undefined);
      return api.addItem({
        productId: input.productId,
        variantId: input.variantId,
        addonIds: input.addonIds,
        quantity: input.quantity,
        notes: input.notes,
        replace: input.replace,
      });
    },
    onMutate: (input) => beginCartChange(client, (current) => bumpCart(current, input)),
    onSuccess: (view, _variables, changeId) => {
      if (typeof changeId === 'number') settleCartChange(client, changeId, view);
      else client.setQueryData(cartQueryKey, view);
      toast.success(t('customer.added'));
      setPrompt(null);
    },
    onError: (error: Error, variables, changeId) => {
      if (typeof changeId === 'number') failCartChange(client, changeId);
      if (!variables.replace && /another merchant/i.test(error.message)) {
        void api
          .cart()
          .then((fresh) => {
            if (!cartChangesPending()) client.setQueryData(cartQueryKey, fresh);
            setPrompt({
              currentStore: storeLabel(fresh, locale, t('customer.anotherStore')),
              nextStore: pickLocalized(variables.merchantName, locale) || t('customer.thisStore'),
              body: variables,
            });
          })
          .catch(() => toast.error(error.message));
        return;
      }
      toast.error(error.message);
    },
  });

  const requestAdd = (merchantId: string, merchantName: StoreName, body: Omit<AddBody, 'merchantName' | 'replace' | 'merchantId'>) => {
    const current = client.getQueryData<CartSnapshot>(cartQueryKey) ?? cart.data;
    const blocked = Boolean(current?.merchant && current.items.length > 0 && current.merchant.id !== merchantId);
    const next = { ...body, merchantName, merchantId };
    if (!blocked) {
      add.mutate(next);
      return true;
    }
    setPrompt({
      currentStore: storeLabel(current, locale, t('customer.anotherStore')),
      nextStore: pickLocalized(merchantName, locale) || t('customer.thisStore'),
      body: next,
    });
    return false;
  };

  const confirming = add.isPending && Boolean(add.variables?.replace);

  const dialog = (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open && !confirming) setPrompt(null);
      }}
    >
      <DialogContent>
        <DialogTitle>{t('customer.switchStoreTitle')}</DialogTitle>
        <DialogDescription>
          {t('customer.switchStoreBody', {
            store: prompt?.currentStore || t('customer.anotherStore'),
            next: prompt?.nextStore || t('customer.thisStore'),
          })}
        </DialogDescription>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="rounded-full" disabled={confirming} onClick={() => setPrompt(null)}>
            {t('customer.switchStoreKeep')}
          </Button>
          <Button
            type="button"
            variant="yellow"
            className="rounded-full"
            loading={confirming}
            onClick={() => {
              if (!prompt || confirming) return;
              add.mutate({ ...prompt.body, replace: true });
            }}
          >
            {t('customer.switchStoreConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return {
    requestAdd,
    pendingId: add.isPending ? (add.variables?.productId ?? null) : null,
    pending: add.isPending,
    dialog,
  };
}

function storeLabel(cart: CartSnapshot | undefined, locale: 'en' | 'ar', fallback: string) {
  return pickLocalized(cart?.merchant?.name, locale) || fallback;
}
