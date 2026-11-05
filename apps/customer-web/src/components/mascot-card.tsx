import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'use-intl';

/** A friendly box with the Alliva mascot waving, for screens with nothing to show yet. */
export function MascotCard({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg rounded-[28px] border border-[#ecece6] bg-white px-6 pt-8 pb-10 text-center">
      <span className="mascot-wave mx-auto block size-28 overflow-hidden rounded-full bg-primary shadow-[0_8px_24px_rgba(255,196,0,0.35)] ring-4 ring-[#fff6d6]">
        <img src="/mascot.png" alt="" className="size-full object-cover" />
      </span>
      <h1 className="mt-5 text-2xl">{title}</h1>
      <p className="mx-auto mt-2 max-w-[320px] text-sm text-[#6f6f6a]">{body}</p>
      {children ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Sign in, then come straight back to this page. */
export function SignInLink() {
  const t = useTranslations();
  const pathname = usePathname();
  return (
    <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-[#111]">
      {t('auth.signIn')}
    </Link>
  );
}
