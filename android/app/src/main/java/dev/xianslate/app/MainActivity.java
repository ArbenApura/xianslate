package dev.xianslate.app;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		// CAPACITOR'S LIBRARY ROOT (CoordinatorLayout) IGNORES SYSTEM-BAR INSETS — IT DELEGATES TO
		// BEHAVIORS AND APPLIES NO PADDING. WITH THE THEME'S windowOptOutEdgeToEdgeEnforcement (LEGACY
		// LAYOUT — SEE styles.xml) THE WINDOW IS FULL-SCREEN AND THE OPAQUE STATUS BAR WOULD COVER THE
		// WebView'S TOP ("CUT"). CONSUME THE SYSTEM-BAR INSETS AS TOP PADDING ON THE CONTENT ROOT SO THE
		// WEB CONTENT STARTS BELOW THE STATUS BAR. THE BOTTOM IS ALREADY INSET BY THE DECOR IN LEGACY
		// MODE, SO ONLY THE TOP IS APPLIED (NO DOUBLE-INSET).
		View content = findViewById(android.R.id.content);
		ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
			Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
			v.setPadding(0, bars.top, 0, 0);
			return WindowInsetsCompat.CONSUMED;
		});
		ViewCompat.requestApplyInsets(content);
	}
}
