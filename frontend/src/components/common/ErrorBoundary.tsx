import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** When this changes (for example the page), a shown error is cleared and the children are tried again. */
  resetKey?: string;
  /** Where the failure happened, for the message ("this page", "the app"). */
  where?: string;
}

interface State {
  error: Error | null;
  key: string | undefined;
}

/** Keeps one broken part of the page from blanking the whole app, and says what to do about it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Something broke while drawing the page:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl space-y-3 rounded-lg border border-tampered p-4">
        <h2 className="text-lg font-semibold text-tampered">Something went wrong on {this.props.where ?? "this page"}</h2>
        <p>The rest of the app is still working. Your chain and your transactions are not affected: this is a problem in how the page was drawn.</p>
        <pre className="max-h-32 overflow-auto rounded-md bg-surface-2 p-2 text-xs">{error.message}</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => this.setState({ error: null })} className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-solid">
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
