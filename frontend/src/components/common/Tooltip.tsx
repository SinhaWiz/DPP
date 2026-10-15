import {
  autoUpdate, flip, FloatingPortal, offset, safePolygon, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole,
} from "@floating-ui/react";
import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";

interface Props {
  /** What to show. Keep it informative: a tooltip is the only place some details appear. */
  content: ReactNode;
  /** A single element that can take a ref and props. */
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  /** Milliseconds to wait before showing on hover. */
  delay?: number;
  /** Let the pointer move into the tooltip (for copy buttons and links inside it). */
  interactive?: boolean;
  disabled?: boolean;
}

/**
 * A tooltip that opens on hover and on keyboard focus, closes on Esc or blur, stays inside the
 * viewport, and is announced to screen readers through aria-describedby.
 */
export function Tooltip({ content, children, placement = "top", delay = 120, interactive = false, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: open && !disabled,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: delay, close: 80 }, handleClose: interactive ? safePolygon() : null });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  if (!isValidElement(children)) return children;
  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: refs.setReference,
    ...getReferenceProps((children.props as Record<string, unknown>) ?? {}),
  });

  return (
    <>
      {trigger}
      {open && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text shadow-xl"
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
