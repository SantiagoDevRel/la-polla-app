package com.lapollacolombiana.app;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().getDecorView().setBackgroundResource(R.color.splash_background);

        // Reserve the system bars/cutout and keyboard natively. The hosted web
        // layout and the offline page get the same usable viewport on old and
        // new WebViews, including Android 16's mandatory edge-to-edge mode.
        View container = (View) getBridge().getWebView().getParent();
        // Insets expose this container around the WebView. Its default theme
        // background can be white even when the WebView/decor are dark.
        container.setBackgroundResource(R.color.splash_background);
        ViewCompat.setOnApplyWindowInsetsListener(container, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            // Zero the insets already applied here so CSS env() never doubles
            // them. Preserve dispatch instead of CONSUMED for keyboard changes.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(container);
    }
}
