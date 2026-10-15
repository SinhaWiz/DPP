import { EmptyState } from "@/components/layout/Panels";

function Page({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mb-4 text-muted">{subtitle}</p>
      {children}
    </div>
  );
}

export const NotFound = () => (
  <Page title="Page not found" subtitle="That address does not exist.">
    <a className="text-accent underline" href="/">Back to the Explorer</a>
  </Page>
);
