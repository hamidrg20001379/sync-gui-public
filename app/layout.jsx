import './globals.css';

export const metadata = {
  title: 'Sync Control',
  description: 'Project and remote sync GUI'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
