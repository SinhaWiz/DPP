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

export const Playground = () => (
  <Page title="Playground" subtitle="Act as any role and watch each transaction travel step by step.">
    <EmptyState title="Pick a role to start" />
  </Page>
);
export const LearnPage = () => (
  <Page title="Learn" subtitle="Guided lessons from “what is a block?” to breaking the chain.">
    <EmptyState title="Lessons are on their way" />
  </Page>
);
export const NotFound = () => (
  <Page title="Page not found" subtitle="That address does not exist.">
    <a className="text-accent underline" href="/">Back to the Explorer</a>
  </Page>
);
