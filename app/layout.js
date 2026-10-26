import "./globals.css";

export const metadata = {
  title: "Sistem Bukti Pengiriman Kurir",
  description: "Aplikasi untuk mengumpulkan foto bukti pengiriman barang",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}