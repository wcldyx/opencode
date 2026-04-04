package ai.opencode.mobile;

import android.content.Intent;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.security.SecureRandom;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "MainActivity";
  private static final String EXTRA_HREF = "href";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativeHttpPlugin.class);
    registerPlugin(NativeKeepalivePlugin.class);
    KeepaliveService.attach(this);

    try {
      TrustManager[] trust = new TrustManager[] {
        new X509TrustManager() {
          @Override
          public void checkClientTrusted(X509Certificate[] chain, String authType) {}

          @Override
          public void checkServerTrusted(X509Certificate[] chain, String authType) {}

          @Override
          public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[] {};
          }
        }
      };

      SSLContext ssl = SSLContext.getInstance("TLS");
      ssl.init(null, trust, new SecureRandom());
      HttpsURLConnection.setDefaultSSLSocketFactory(ssl.getSocketFactory());
      HttpsURLConnection.setDefaultHostnameVerifier((HostnameVerifier) (hostname, session) -> true);
    } catch (Exception ignored) {
    }

    super.onCreate(savedInstanceState);

    try {
      Log.d(TAG, "start keepalive from activity");
      ContextCompat.startForegroundService(this, new Intent(this, KeepaliveService.class));
    } catch (Exception err) {
      Log.e(TAG, "start keepalive failed", err);
    }

    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

    WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (bars != null) {
      bars.setAppearanceLightStatusBars(true);
      bars.setAppearanceLightNavigationBars(true);
    }

    if (bridge == null || bridge.getWebView() == null) return;
    WebView web = bridge.getWebView();

    web.setWebViewClient(
      new BridgeWebViewClient(bridge) {
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
          if (handler != null) handler.proceed();
        }
      }
    );

    route(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    route(intent);
  }

  @Override
  public void onResume() {
    KeepaliveService.setActive(true);
    super.onResume();
  }

  @Override
  public void onPause() {
    KeepaliveService.setActive(false);
    super.onPause();
  }

  private void route(Intent intent) {
    if (intent == null) return;
    String href = intent.getStringExtra(EXTRA_HREF);
    if (href == null || href.isEmpty()) return;
    if (bridge == null || bridge.getWebView() == null) return;
    bridge.getWebView().loadUrl("http://localhost" + href);
    intent.removeExtra(EXTRA_HREF);
  }
}
