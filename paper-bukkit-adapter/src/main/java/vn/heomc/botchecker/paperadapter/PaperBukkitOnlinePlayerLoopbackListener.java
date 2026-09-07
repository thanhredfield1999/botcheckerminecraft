package vn.heomc.botchecker.paperadapter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.util.Arrays;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * Single-flight, bounded listener that accepts only IPv4 loopback connections.
 * The listener owns the supplied processor after a successful bind.
 */
public final class PaperBukkitOnlinePlayerLoopbackListener implements AutoCloseable {
  private static final byte[] LOOPBACK_ADDRESS = {127, 0, 0, 1};
  private static final int REQUEST_HEADER_BYTES = 9;
  private static final int MAX_REQUEST_BODY_BYTES = 4 * 1024;
  private static final int MIN_SOCKET_TIMEOUT_MS = 1;
  private static final int MAX_SOCKET_TIMEOUT_MS = 60_000;
  private static final int ACCEPT_BACKLOG = 1;
  private static final long CLOSE_QUIESCENCE_TIMEOUT_MS = 250L;

  private final Object stateLock = new Object();
  private final ServerSocket serverSocket;
  private final int socketTimeoutMs;
  private final PaperBukkitOnlinePlayerRequestProcessor processor;
  private final Thread acceptThread;
  private boolean open = true;
  private Socket activeSocket;
  private Thread activeWorker;

  private PaperBukkitOnlinePlayerLoopbackListener(
      ServerSocket serverSocket,
      int socketTimeoutMs,
      PaperBukkitOnlinePlayerRequestProcessor processor) {
    this.serverSocket = serverSocket;
    this.socketTimeoutMs = socketTimeoutMs;
    this.processor = processor;
    this.acceptThread = Thread.ofPlatform()
        .daemon(true)
        .name("botchecker-paper-bukkit-loopback")
        .unstarted(this::acceptLoop);
  }

  public static PaperBukkitOnlinePlayerLoopbackListener bind(
      int port,
      int socketTimeoutMs,
      PaperBukkitOnlinePlayerRequestProcessor processor) {
    if (port < 0 || port > 65_535
        || socketTimeoutMs < MIN_SOCKET_TIMEOUT_MS
        || socketTimeoutMs > MAX_SOCKET_TIMEOUT_MS) {
      throw new IllegalArgumentException("PAPER_BUKKIT_LISTENER_OPTIONS_INVALID");
    }
    Objects.requireNonNull(processor, "processor");
    ServerSocket serverSocket = null;
    try {
      InetAddress loopback = InetAddress.getByAddress(LOOPBACK_ADDRESS);
      serverSocket = new ServerSocket();
      serverSocket.setReuseAddress(false);
      serverSocket.bind(new InetSocketAddress(loopback, port), ACCEPT_BACKLOG);
      if (!serverSocket.getInetAddress().equals(loopback)) {
        throw new IOException("unexpected bind address");
      }
      var listener = new PaperBukkitOnlinePlayerLoopbackListener(
          serverSocket, socketTimeoutMs, processor);
      listener.acceptThread.start();
      return listener;
    } catch (Exception error) {
      closeQuietly(serverSocket);
      processor.close();
      throw new IllegalStateException("PAPER_BUKKIT_LISTENER_BIND_FAILED");
    }
  }

  public String localAddress() {
    return serverSocket.getInetAddress().getHostAddress();
  }

  public int localPort() {
    return serverSocket.getLocalPort();
  }

  private void acceptLoop() {
    while (isOpen()) {
      Socket socket;
      try {
        socket = serverSocket.accept();
      } catch (SocketException error) {
        return;
      } catch (IOException error) {
        if (!isOpen()) return;
        continue;
      }
      if (!claimWithTimeout(socket)) {
        closeQuietly(socket);
        continue;
      }
      if (!startClaimed(socket)) {
        release(socket);
        closeQuietly(socket);
      }
    }
  }

  private void handleClaimed(Socket socket) {
    try {
      handle(socket);
    } catch (IOException | RuntimeException error) {
      // Fail closed by returning no response and closing this connection.
    } finally {
      release(socket);
      closeQuietly(socket);
    }
  }

  private boolean startClaimed(Socket socket) {
    Thread worker = Thread.ofPlatform()
        .daemon(true)
        .name("botchecker-paper-bukkit-request")
        .unstarted(() -> handleClaimed(socket));
    synchronized (stateLock) {
      if (!open || activeSocket != socket) return false;
      activeWorker = worker;
      try {
        worker.start();
        return true;
      } catch (RuntimeException error) {
        if (activeWorker == worker) activeWorker = null;
        return false;
      }
    }
  }

  private void handle(Socket socket) throws IOException {
    // Timeout/TCP_NODELAY đã được áp trong claimWithTimeout, trước khi slot bị chiếm.
    byte[] requestFrame = readRequestFrame(socket.getInputStream());
    byte[] responseFrame = processor.process(requestFrame);
    if (!isOpen()) return;
    socket.getOutputStream().write(responseFrame);
    socket.getOutputStream().flush();
    socket.shutdownOutput();
  }

  private static byte[] readRequestFrame(InputStream input) throws IOException {
    byte[] header = readExactly(input, REQUEST_HEADER_BYTES);
    int bodyLength = ((header[5] & 0xff) << 24)
        | ((header[6] & 0xff) << 16)
        | ((header[7] & 0xff) << 8)
        | (header[8] & 0xff);
    if (bodyLength <= 0 || bodyLength > MAX_REQUEST_BODY_BYTES) {
      throw new IOException("invalid request length");
    }
    byte[] body = readExactly(input, bodyLength);
    if (input.read() != -1) throw new IOException("trailing request bytes");
    ByteArrayOutputStream frame = new ByteArrayOutputStream(REQUEST_HEADER_BYTES + bodyLength);
    frame.writeBytes(header);
    frame.writeBytes(body);
    return frame.toByteArray();
  }

  private static byte[] readExactly(InputStream input, int length) throws IOException {
    byte[] bytes = input.readNBytes(length);
    if (bytes.length != length) throw new IOException("truncated request");
    return bytes;
  }

  private boolean claim(Socket socket) {
    synchronized (stateLock) {
      if (!open || activeSocket != null) return false;
      activeSocket = socket;
      return true;
    }
  }

  /**
   * Áp socket timeout TRƯỚC khi chiếm slot single-flight.
   *
   * Nếu timeout chỉ được đặt trong handle(), một client kết nối rồi không gửi gì sẽ
   * giữ slot duy nhất tới hết socketTimeoutMs và chặn verifier hợp lệ. Đặt timeout
   * trước khi claim khiến cửa sổ chặn bị chính timeout đó bao, và một socket không
   * cấu hình được thì bị loại luôn thay vì chiếm chỗ.
   */
  private boolean claimWithTimeout(Socket socket) {
    try {
      socket.setSoTimeout(socketTimeoutMs);
      socket.setTcpNoDelay(true);
    } catch (IOException error) {
      return false;
    }
    return claim(socket);
  }

  private void release(Socket socket) {
    synchronized (stateLock) {
      if (activeSocket == socket) activeSocket = null;
      if (activeWorker == Thread.currentThread()) activeWorker = null;
    }
  }

  private boolean isOpen() {
    synchronized (stateLock) {
      return open;
    }
  }

  @Override
  public void close() {
    Socket socket;
    Thread worker;
    synchronized (stateLock) {
      if (!open) return;
      open = false;
      socket = activeSocket;
      worker = activeWorker;
      activeSocket = null;
      activeWorker = null;
    }
    processor.close();
    closeQuietly(socket);
    closeQuietly(serverSocket);
    acceptThread.interrupt();
    if (worker != null && worker != Thread.currentThread()) worker.interrupt();
    awaitTermination(acceptThread, worker);
  }

  private static void awaitTermination(Thread acceptThread, Thread worker) {
    long timeoutNanos = TimeUnit.MILLISECONDS.toNanos(CLOSE_QUIESCENCE_TIMEOUT_MS);
    long started = System.nanoTime();
    boolean interrupted = false;
    for (Thread thread : new Thread[] {acceptThread, worker}) {
      if (thread == null || thread == Thread.currentThread()) continue;
      long remaining = timeoutNanos - (System.nanoTime() - started);
      if (remaining <= 0) break;
      try {
        thread.join(Math.max(1L, TimeUnit.NANOSECONDS.toMillis(remaining)));
      } catch (InterruptedException error) {
        interrupted = true;
        break;
      }
    }
    if (interrupted) Thread.currentThread().interrupt();
  }

  private static void closeQuietly(AutoCloseable closeable) {
    if (closeable == null) return;
    try {
      closeable.close();
    } catch (Exception ignored) {
      // Closing is best-effort; open=false and processor.close() are authoritative.
    }
  }
}
