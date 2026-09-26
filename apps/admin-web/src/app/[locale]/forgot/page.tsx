'use client';

import { api } from '@/components/providers';
import { Button, Card, Input } from '@alliva/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

export default function ForgotPage() {
  const [email, setEmail] = useState('admin@alliva.bh');
  const [token, setToken] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.forgot(email),
    onSuccess: (result) => setToken(result.devResetToken ?? 'sent'),
  });
  return (
    <Card className="mx-auto mt-16 max-w-md space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Forgot password</h1>
      <Input value={email} onChange={(event) => setEmail(event.target.value)} />
      <Button onClick={() => send.mutate()}>Send reset link</Button>
      {token ? <p className="text-sm">Development reset token: {token}</p> : null}
    </Card>
  );
}
