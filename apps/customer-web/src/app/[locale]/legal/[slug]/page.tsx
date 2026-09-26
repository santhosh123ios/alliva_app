export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = slug === 'privacy' ? 'Privacy' : 'Terms';
  return (
    <article className="prose max-w-2xl">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-4 text-muted-foreground">
        Alliva operates a multi-merchant marketplace in the Kingdom of Bahrain. Prices are shown in Bahraini dinars and orders are scheduled in Asia/Bahrain. This page is the {title.toLowerCase()} placeholder served by the platform settings record.
      </p>
    </article>
  );
}
