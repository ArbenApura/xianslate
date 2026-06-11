<script lang="ts">
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import Loader2 from 'lucide-svelte/icons/loader-2';

	// -- OPTIONAL PROPS -- //
	export let variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary';
	export let size: 'sm' | 'md' = 'md';
	export let type: 'button' | 'submit' = 'button';
	export let href: string | null = null;
	export let disabled = false;
	export let loading = false;
	let className = '';
	export { className as class };

	// -- CONSTANTS -- //
	const BASE =
		'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';
	const VARIANTS = {
		primary: 'border-transparent bg-sky-600 text-white hover:bg-sky-500',
		secondary: 'border-black/10 hover:bg-current/5 dark:border-white/[0.08]',
		ghost: 'border-transparent opacity-70 hover:bg-current/5 hover:opacity-100',
		danger: 'border-transparent text-red-600 hover:bg-red-500/10 dark:text-red-400',
	} as const;
	const SIZES = {
		sm: 'px-2.5 py-1 text-xs',
		md: 'px-3.5 py-2 text-sm',
	} as const;

	// -- REACTIVE STATES -- //
	$: classes = cn(BASE, VARIANTS[variant], SIZES[size], className);
</script>

{#if href}
	<a {href} class={cn(classes, disabled && 'pointer-events-none opacity-50')}><slot /></a>
{:else}
	<button {type} {disabled} class={classes} on:click>
		{#if loading}<Loader2 size={15} class="animate-spin" />{/if}
		<slot />
	</button>
{/if}
