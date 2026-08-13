import './globals.css';
import TauriBridge from './components/TauriBridge';

export const metadata = {
  title: 'Sync GUI',
  description: 'SSH file synchronization and server management'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <TauriBridge />
        {children}
      </body>
    </html>
  );
}
