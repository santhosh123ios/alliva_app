'use client';

import { api } from '@/components/providers';
import { otpRequestSchema, otpVerifySchema } from '@alliva/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, Input, Label } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('+97336000001');
  const request = useForm<z.infer<typeof otpRequestSchema>>({ resolver: zodResolver(otpRequestSchema), defaultValues: { phone } });
  const verify = useForm<z.infer<typeof otpVerifySchema>>({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { phone, code: '123456', firstName: 'Abdulla', lastName: 'Kanoo' },
  });
  const send = useMutation({
    mutationFn: request.handleSubmit((values) => api.requestOtp(values.phone)),
    onSuccess: () => toast.success('Code sent. In development it is 123456.'),
    onError: (error: Error) => toast.error(error.message),
  });
  const confirm = useMutation({
    mutationFn: verify.handleSubmit((values) => api.verifyOtp(values)),
    onSuccess: () => router.push('/'),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <Card className="space-y-3 p-6">
        <h1 className="text-2xl font-semibold">Customer sign in</h1>
        <Label>Mobile</Label>
        <Input {...request.register('phone')} onChange={(event) => { setPhone(event.target.value); verify.setValue('phone', event.target.value); }} />
        <Button type="button" onClick={() => send.mutate()}>Send code</Button>
      </Card>
      <Card className="space-y-3 p-6">
        <Label>Code</Label>
        <Input {...verify.register('code')} />
        <Button type="button" onClick={() => confirm.mutate()}>Verify and continue</Button>
      </Card>
    </div>
  );
}
