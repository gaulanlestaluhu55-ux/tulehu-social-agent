import './globals.css';

export const metadata = {
  title: 'Tulehu Dashboard',
  description: 'Content management dashboard for Tulehu Inkline',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
