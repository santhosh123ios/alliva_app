export function Logo({ className = 'h-10' }: { className?: string }) {
  return <img src="/logo.png" alt="Alliva" className={className} />;
}

export function Mascot({ className = 'h-40' }: { className?: string }) {
  return <img src="/mascot.png" alt="" className={className} />;
}
