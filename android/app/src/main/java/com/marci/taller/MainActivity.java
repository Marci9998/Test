package com.marci.taller;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * La aplicación es una ventana a tu propio servidor del Taller.
 *
 * No lleva datos dentro: todo vive en el equipo donde corre server.py, así que
 * lo que ves en el móvil es lo mismo que en el ordenador. La primera vez pide
 * la dirección (la que sale al instalar, por ejemplo http://192.168.0.113:8477).
 */
public class MainActivity extends Activity {

    private static final String PREFS = "taller";
    private static final String KEY_URL = "url";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        String url = prefs().getString(KEY_URL, "");
        if (url.isEmpty()) {
            showSetup(null);
            return;
        }
        showWeb(url, state);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Pantalla para escribir la dirección del servidor ──────────────

    private void showSetup(String current) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(64, 64, 64, 64);
        root.setBackgroundColor(Color.parseColor("#0f1216"));

        TextView title = new TextView(this);
        title.setText("Taller");
        title.setTextSize(28);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);

        TextView help = new TextView(this);
        help.setText("Escribe la dirección de tu servidor, la que salió al instalarlo.\n"
                + "Suele ser algo así:\n\nhttp://192.168.1.50:8477");
        help.setTextSize(15);
        help.setTextColor(Color.parseColor("#a2abb8"));
        help.setGravity(Gravity.CENTER);
        help.setPadding(0, 32, 0, 32);

        final EditText input = new EditText(this);
        input.setHint("http://192.168.1.50:8477");
        input.setText(current != null ? current : "http://");
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.parseColor("#737d8b"));
        input.setSingleLine(true);

        Button save = new Button(this);
        save.setText("Conectar");
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String value = input.getText().toString().trim();
                if (!value.startsWith("http://") && !value.startsWith("https://")) {
                    value = "http://" + value;
                }
                if (value.length() < 12) {
                    Toast.makeText(MainActivity.this,
                            "Esa dirección no parece correcta", Toast.LENGTH_SHORT).show();
                    return;
                }
                prefs().edit().putString(KEY_URL, value).apply();
                recreate();
            }
        });

        LinearLayout.LayoutParams wide = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);

        root.addView(title, wide);
        root.addView(help, wide);
        root.addView(input, wide);
        root.addView(save, wide);
        setContentView(root);
    }

    // ── La aplicación en sí ───────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private void showWeb(String url, Bundle state) {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);            // la aplicación usa localStorage
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        // la sesión tiene que sobrevivir a cerrar la aplicación
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        final String base = url;
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String target = request.getUrl().toString();
                // lo del servidor se queda dentro; lo de fuera (tiendas, Wallapop)
                // se abre en el navegador, que es donde tienes tus sesiones
                if (target.startsWith(base)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(target)));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "No hay con qué abrir ese enlace", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) showNotFound(base);
            }
        });

        // descargar copias de seguridad y CSV
        web.setDownloadListener((downloadUrl, agent, disposition, mime, size) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)));
            } catch (Exception e) {
                Toast.makeText(this, "No se pudo descargar", Toast.LENGTH_SHORT).show();
            }
        });

        setContentView(web);

        if (state != null) web.restoreState(state);
        else web.loadUrl(url);
    }

    private void showNotFound(final String url) {
        new AlertDialog.Builder(this)
                .setTitle("No se llega al servidor")
                .setMessage("No responde " + url + ".\n\n"
                        + "Comprueba que el equipo está encendido y que el móvil está "
                        + "en el mismo wifi.")
                .setPositiveButton("Reintentar", (d, w) -> web.reload())
                .setNegativeButton("Cambiar dirección", (d, w) -> showSetup(url))
                .setCancelable(true)
                .show();
    }

    // ── Botones del móvil ─────────────────────────────────────────────

    @Override
    public boolean onKeyDown(int code, KeyEvent event) {
        if (code == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(code, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public boolean onCreateOptionsMenu(android.view.Menu menu) {
        menu.add(0, 1, 0, "Recargar");
        menu.add(0, 2, 0, "Cambiar dirección");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(android.view.MenuItem item) {
        if (item.getItemId() == 1 && web != null) { web.reload(); return true; }
        if (item.getItemId() == 2) {
            showSetup(prefs().getString(KEY_URL, ""));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
}
