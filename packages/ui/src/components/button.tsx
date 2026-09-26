import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground hover:bg-[#2a2a2a]',
        yellow: 'bg-primary text-primary-foreground hover:bg-[#ffcf33]',
        black: 'bg-secondary text-secondary-foreground hover:bg-[#2a2a2a]',
        outline: 'border border-foreground bg-card text-foreground hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground',
      },
      size: {
        default: 'h-12 min-w-11 px-4',
        sm: 'h-11 px-3 text-xs',
        lg: 'h-12 px-6',
        icon: 'h-12 w-12',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    if (asChild) {
      return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>{children}</Comp>;
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), loading && 'relative')}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <svg className="size-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
        ) : null}
        <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
