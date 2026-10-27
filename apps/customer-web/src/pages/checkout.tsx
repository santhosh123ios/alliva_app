import { api } from '@/components/providers';
import { pickLocalized } from '@alliva/design-tokens';
import { checkoutSchema } from '@alliva/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, Input, Label } from '@alliva/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useLocale } from 'use-intl';
import type { z } from 'zod';

type FormValues = z.infer<typeof checkoutSchema>;

export default function CheckoutPage() {
  const router = useRouter();
  const locale = useLocale() as 'en' | 'ar';
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.cart() });
  const methods = cart.data?.paymentMethods;
  const form = useForm<FormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { paymentMethod: methods?.[0]?.code ?? 'TAP_PAY', fulfillmentType: 'DELIVERY' },
  });
  const place = useMutation({
    mutationFn: (values: FormValues) => api.checkout(values, crypto.randomUUID()),
    onSuccess: (order) => router.push(`/orders/${order.id}`),
    onError: (error: Error) => {
      if ((error as { status?: number }).status === 401) router.push('/login');
      toast.error(error.message);
    },
  });
  useEffect(() => {
    if (!methods?.length) return;
    const current = form.getValues('paymentMethod');
    if (!methods.some((method) => method.code === current)) form.setValue('paymentMethod', methods[0]!.code);
  }, [methods, form]);
  if (me.isError) {
    return (
      <Card className="p-6">
        <p>Sign in with your Bahrain mobile number to place this order.</p>
        <Button className="mt-4" onClick={() => router.push('/login')}>Sign in</Button>
      </Card>
    );
  }
  return (
    <form className="mx-auto max-w-xl space-y-4" onSubmit={form.handleSubmit((values) => place.mutate(values))}>
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <Label>Fulfillment</Label>
      <select className="h-11 w-full rounded-xl border px-3" {...form.register('fulfillmentType')}>
        <option value="DELIVERY">Delivery</option>
        <option value="TAKEAWAY">Takeaway</option>
        <option value="DINE_IN">Dine-in</option>
      </select>
      <Label>Payment</Label>
      <select className="h-11 w-full rounded-xl border px-3" {...form.register('paymentMethod')}>
        {(methods ?? []).map((method) => (
          <option key={method.code} value={method.code}>{pickLocalized(method.name, locale)}</option>
        ))}
      </select>
      {!cart.isLoading && cart.data?.merchant && !methods?.length ? <p className="text-sm text-[#D9342B]">This store is not accepting a payment method right now.</p> : null}
      <Input placeholder="Notes for the courier" {...form.register('notes')} />
      <Card className="p-4 text-sm">Total {cart.data?.pricing.total ?? '0.000'} BHD. The server recalculates this before charging.</Card>
      <Button type="submit" variant="yellow" loading={place.isPending} disabled={Boolean(cart.data?.merchant) && !methods?.length}>Place order</Button>
    </form>
  );
}
