// CAPACITOR NATIVE RUNTIME ADAPTER — REGISTERED ONCE FROM THE ROOT LAYOUT'S onMount. EVERYTHING IS
// GUARDED BY Capacitor.isNativePlatform() SO THE WEB BUILD NEVER TOUCHES THE NATIVE PLUGINS (THEY ARE
// SAFE TO IMPORT — THE WEB IMPLEMENTATIONS NO-OP — BUT WE SKIP THE LISTENERS ENTIRELY ANYWAY).

// IMPORTED DEP-MODULES
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
// IMPORTED MODULES
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { refreshUser } from '$lib/stores/auth';
import { isDarkTheme, settings, THEME_BG, type Theme } from '$lib/stores/settings';
import { syncNow } from '$lib/offline/sync';
import { tts } from '$lib/tts/engine';

// -- STATES -- //

let registered = false;

// -- FUNCTIONS -- //

// KEEP THE STATUS BAR IN SYNC WITH THE ACTIVE READER THEME — THE WEB COUNTERPART OF THE theme-color META
// TAG (applyThemeClass IN $lib/stores/settings). iOS HAS NO BACKGROUND-COLOUR API — STYLE ONLY.
function applyStatusBar(theme: Theme) {
	const isDark = isDarkTheme(theme);
	StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
	if (Capacitor.getPlatform() === 'android') {
		StatusBar.setBackgroundColor({ color: THEME_BG[theme] }).catch(() => {});
	}
}

// WIRE UP NATIVE EVENTS + PLUGIN DEFAULTS. IDEMPOTENT (THE ROOT LAYOUT CAN MOUNT MULTIPLE TIMES UNDER HMR).
export function initNativeRuntime(): void {
	if (!browser || !Capacitor.isNativePlatform() || registered) return;
	registered = true;

	// ANDROID HARDWARE BACK BUTTON: THE SPA ROUTER USES pushState HISTORY, WHICH THE BACK BUTTON DOES NOT
	// DRIVE — GO BACK THROUGH THE ROUTER WHEN THERE IS HISTORY, OTHERWISE MINIMIZE (ANDROID CONVENTION —
	// NO SUDDEN APP EXIT; A SECOND PRESS MINIMIZES TO THE HOME SCREEN, NOTHING IS KILLED).
	App.addListener('backButton', ({ canGoBack }) => {
		if (canGoBack) history.back();
		else App.minimizeApp();
	}).catch(() => {});

	// LIFECYCLE: PAUSE TTS WHEN THE APP GOES TO THE BACKGROUND (THE WEBVIEW KEEPS RUNNING, SO THE SENTENCE
	// WOULD OTHERWISE KEEP SPEAKING); FRESHEN THE SESSION WHEN IT RETURNS TO THE FOREGROUND, AND FLUSH ANY
	// WRITES QUEUED WHILE OFFLINE (OR AHEAD OF AN IMPENDING NETWORK DROP).
	App.addListener('pause', () => tts.pause()).catch(() => {});
	App.addListener('resume', () => {
		refreshUser();
		void syncNow();
	}).catch(() => {});

	// KEYBOARD: NATIVE RESIZE MODE SO DIALOG INPUTS AREN'T COVERED BY THE ON-SCREEN KEYBOARD.
	Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});

	// STATUS BAR FOLLOWS THE THEME, INCLUDING LIVE THEME SWITCHES IN THE READER.
	applyStatusBar(get(settings).theme);
	settings.subscribe((s) => applyStatusBar(s.theme));
}
