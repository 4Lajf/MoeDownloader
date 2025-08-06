<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary/70",
				destructive:
					"bg-destructive shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white",
				outline:
					"bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-muted/40 dark:border-muted dark:hover:bg-muted/60 border",
				secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 dark:bg-secondary/60 dark:hover:bg-secondary/50",
				ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
				link: "text-primary underline-offset-4 hover:underline",
				// New muted colorful variants
				success: "bg-green-700 text-white shadow-xs hover:bg-green-800 focus-visible:ring-green-600/20 dark:bg-green-800 dark:hover:bg-green-700 transition-colors",
				warning: "bg-amber-700 text-white shadow-xs hover:bg-amber-800 focus-visible:ring-amber-600/20 dark:bg-amber-800 dark:hover:bg-amber-700 transition-colors",
				info: "bg-blue-700 text-white shadow-xs hover:bg-blue-800 focus-visible:ring-blue-600/20 dark:bg-blue-800 dark:hover:bg-blue-700 transition-colors",
				purple: "bg-purple-700 text-white shadow-xs hover:bg-purple-800 focus-visible:ring-purple-600/20 dark:bg-purple-800 dark:hover:bg-purple-700 transition-colors",
				// Enhanced outline variants with muted colors and better opacity
				"outline-success": "border border-green-700 text-green-700 hover:bg-green-700/10 hover:text-green-800 dark:border-green-600 dark:text-green-400 dark:hover:bg-green-600/10 dark:hover:text-green-300 transition-colors",
				"outline-warning": "border border-amber-700 text-amber-700 hover:bg-amber-700/10 hover:text-amber-800 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-600/10 dark:hover:text-amber-300 transition-colors",
				"outline-info": "border border-blue-700 text-blue-700 hover:bg-blue-700/10 hover:text-blue-800 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-600/10 dark:hover:text-blue-300 transition-colors",
				"outline-purple": "border border-purple-700 text-purple-700 hover:bg-purple-700/10 hover:text-purple-800 dark:border-purple-600 dark:text-purple-400 dark:hover:bg-purple-600/10 dark:hover:text-purple-300 transition-colors",
				"outline-destructive": "border border-red-700 text-red-700 hover:bg-red-700/10 hover:text-red-800 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-600/10 dark:hover:text-red-300 transition-colors",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				icon: "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
