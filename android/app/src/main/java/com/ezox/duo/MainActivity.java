package com.ezox.duo;

import android.Manifest;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * EZOX Duo — Rave-style screen:
 *   top    = streaming site (Netflix / YouTube / Prime / Hotstar) with the user's own login
 *   middle = site buttons
 *   bottom = Duo call + chat (our web app)
 * A small script inside the streaming site reports play / pause / seek, and this activity
 * forwards it to the partner over a WebSocket (same channel as the Chrome extension).
 */
public class MainActivity extends Activity {

    static final String SERVER = "https://ezox-duo.onrender.com";
    // Streaming sites only give the full player to desktop browsers.
    static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    static final int BG = Color.parseColor("#0d0b14");

    private WebView duo, player;
    private LinearLayout column;
    private FrameLayout fullscreenBox;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private boolean expanded = false;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build();
    private WebSocket ws;
    private String room, pass, name;
    private boolean wantSocket = false;
    private int retry = 0;
    private String lastJoined = null;
    private String playerJs = "";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WebView.setWebContentsDebuggingEnabled(true);
        playerJs = readAsset("player.js");

        if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, 1);
        }

        FrameLayout rootBox = new FrameLayout(this);
        rootBox.setBackgroundColor(BG);

        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        rootBox.addView(column, new FrameLayout.LayoutParams(-1, -1));

        player = new WebView(this);
        column.addView(player, new LinearLayout.LayoutParams(-1, 0, 1f));

        column.addView(buildSiteBar(), new LinearLayout.LayoutParams(-1, -2));

        duo = new WebView(this);
        column.addView(duo, new LinearLayout.LayoutParams(-1, 0, 1.1f));

        fullscreenBox = new FrameLayout(this);
        fullscreenBox.setBackgroundColor(Color.BLACK);
        fullscreenBox.setVisibility(View.GONE);
        rootBox.addView(fullscreenBox, new FrameLayout.LayoutParams(-1, -1));

        setContentView(rootBox);
        CookieManager.getInstance().setAcceptCookie(true);
        setupPlayer();
        setupDuo();
    }

    /* ---------------- site buttons ---------------- */

    private View buildSiteBar() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setBackgroundColor(Color.parseColor("#17141f"));
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(6), dp(6), dp(6), dp(6));
        scroll.addView(bar);

        bar.addView(chip("Netflix", "#b20710", v -> openSite("https://www.netflix.com/browse")));
        bar.addView(chip("YouTube", "#cc0000", v -> openSite("https://www.youtube.com")));
        bar.addView(chip("Prime", "#1a98ff", v -> openSite("https://www.primevideo.com")));
        bar.addView(chip("Hotstar", "#1f3c88", v -> openSite("https://www.hotstar.com/in")));
        bar.addView(chip("⤢ Bara", "#2a2436", v -> toggleSize((TextView) v)));
        bar.addView(chip("↻", "#2a2436", v -> player.reload()));
        return scroll;
    }

    private TextView chip(String text, String color, View.OnClickListener click) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.WHITE);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(14);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(14), dp(8), dp(14), dp(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(color));
        bg.setCornerRadius(dp(18));
        t.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.setMargins(dp(4), 0, dp(4), 0);
        t.setLayoutParams(lp);
        t.setOnClickListener(click);
        return t;
    }

    private void toggleSize(TextView btn) {
        expanded = !expanded;
        LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) duo.getLayoutParams();
        lp.weight = expanded ? 0.45f : 1.1f;
        duo.setLayoutParams(lp);
        btn.setText(expanded ? "⤡ Chhota" : "⤢ Bara");
    }

    private void openSite(String url) {
        player.loadUrl(url);
    }

    /* ---------------- streaming site (top) ---------------- */

    private void setupPlayer() {
        WebSettings s = player.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(DESKTOP_UA);
        CookieManager.getInstance().setAcceptThirdPartyCookies(player, true);
        player.setBackgroundColor(BG);
        player.addJavascriptInterface(new PlayerBridge(), "DuoBridge");

        player.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String scheme = req.getUrl().getScheme();
                // Stay inside the app: block "open in Netflix app" style links
                return !("http".equals(scheme) || "https".equals(scheme));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                inject();
            }
        });

        player.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Netflix / Prime need DRM ("protected media") to play
                ui.post(() -> {
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID});
                            return;
                        }
                    }
                    request.deny();
                });
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                enterFullscreen(view, callback);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }
        });

        player.loadDataWithBaseURL(null,
                "<html><body style='margin:0;background:#0d0b14;color:#9a92ab;font-family:sans-serif;"
                        + "display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;box-sizing:border-box'>"
                        + "<div><div style='font-size:42px'>🎬</div><p style='font-size:16px;line-height:1.5'>"
                        + "Neeche ke button se <b style='color:#fff'>Netflix, YouTube, Prime ya Hotstar</b> kholo.<br>"
                        + "Pehli dafa login karna hoga — phir yaad rahega.</p></div></body></html>",
                "text/html", "utf-8", null);

        // Streaming sites change pages without reloading — keep the sync script in place
        ui.postDelayed(new Runnable() {
            @Override public void run() { inject(); ui.postDelayed(this, 2000); }
        }, 2000);
    }

    private void inject() {
        if (playerJs.isEmpty()) return;
        String url = player.getUrl();
        if (url == null || !url.startsWith("http")) return;
        player.evaluateJavascript(playerJs, null);
    }

    private void enterFullscreen(View view, WebChromeClient.CustomViewCallback cb) {
        if (customView != null) { cb.onCustomViewHidden(); return; }
        customView = view;
        customCallback = cb;
        fullscreenBox.addView(view, new FrameLayout.LayoutParams(-1, -1));
        fullscreenBox.setVisibility(View.VISIBLE);
        column.setVisibility(View.GONE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void exitFullscreen() {
        if (customView == null) return;
        fullscreenBox.removeView(customView);
        fullscreenBox.setVisibility(View.GONE);
        column.setVisibility(View.VISIBLE);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    /** Called from player.js inside the streaming site */
    class PlayerBridge {
        @JavascriptInterface
        public void post(String json) {
            WebSocket w = ws;
            if (w != null) w.send(json);
        }

        @JavascriptInterface
        public void ready() {
            String j = lastJoined;
            if (j != null) ui.post(() -> toPlayer(j));
        }
    }

    private void toPlayer(String json) {
        player.evaluateJavascript("window.__duoIn && window.__duoIn(" + JSONObject.quote(json) + ")", null);
    }

    /* ---------------- Duo call + chat (bottom) ---------------- */

    private void setupDuo() {
        WebSettings s = duo.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " EZOXDuoApp");
        duo.setBackgroundColor(BG);
        duo.addJavascriptInterface(new DuoNative(), "DuoNative");
        duo.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                return !SERVER.contains(String.valueOf(u.getHost()));
            }
        });
        duo.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                ui.post(() -> request.grant(request.getResources())); // camera + mic for the call
            }
        });
        duo.loadUrl(SERVER + "/?app=1");
    }

    /** Called from app.js in the Duo page once the user joins a room */
    class DuoNative {
        @JavascriptInterface
        public void joined(String r, String p, String n) {
            ui.post(() -> {
                room = r; pass = p; name = n;
                wantSocket = true;
                retry = 0;
                connectSocket();
            });
        }

        @JavascriptInterface
        public void left() {
            ui.post(() -> {
                wantSocket = false;
                lastJoined = null;
                if (ws != null) ws.close(1000, "bye");
                ws = null;
            });
        }
    }

    private void connectSocket() {
        if (!wantSocket || room == null) return;
        if (ws != null) ws.cancel();
        String url = SERVER.replace("https://", "wss://");
        ws = http.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
            @Override
            public void onOpen(WebSocket socket, Response response) {
                retry = 0;
                try {
                    JSONObject j = new JSONObject();
                    j.put("type", "join");
                    j.put("kind", "netflix");
                    j.put("room", room);
                    j.put("password", pass);
                    j.put("name", name);
                    socket.send(j.toString());
                } catch (Exception ignored) { }
            }

            @Override
            public void onMessage(WebSocket socket, String text) {
                try {
                    JSONObject m = new JSONObject(text);
                    String type = m.optString("type");
                    if ("joined".equals(type)) {
                        JSONObject copy = new JSONObject(text);
                        copy.remove("state"); // old play position must not be replayed on later pages
                        lastJoined = copy.toString();
                    }
                    if ("error".equals(type)) {
                        wantSocket = false;
                        ui.post(() -> Toast.makeText(MainActivity.this, "Sync: " + m.optString("message"), Toast.LENGTH_LONG).show());
                    }
                } catch (Exception ignored) { }
                ui.post(() -> toPlayer(text));
            }

            @Override
            public void onClosed(WebSocket socket, int code, String reason) { reconnectLater(socket); }

            @Override
            public void onFailure(WebSocket socket, Throwable t, Response response) { reconnectLater(socket); }
        });
    }

    private void reconnectLater(WebSocket socket) {
        if (socket != ws || !wantSocket) return;
        long delay = Math.min(30000, 2000L * (++retry));
        ui.postDelayed(this::connectSocket, delay);
    }

    /* ---------------- misc ---------------- */

    @Override
    public void onBackPressed() {
        if (customView != null) { exitFullscreen(); return; }
        if (player.canGoBack()) { player.goBack(); return; }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        wantSocket = false;
        if (ws != null) ws.close(1000, "bye");
        duo.destroy();
        player.destroy();
        super.onDestroy();
    }

    private String readAsset(String file) {
        try (InputStream in = getAssets().open(file)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        for (int r : results) {
            if (r != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Call ke liye camera aur mic ki ijazat chahiye", Toast.LENGTH_LONG).show();
                return;
            }
        }
        duo.reload();
    }
}
