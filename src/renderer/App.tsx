import { useState } from 'react';
import { NavSidebar, type Section } from './components/NavSidebar';
import { PenRootProvider } from './state/PenRootContext';
import { ComputerFolderProvider } from './state/ComputerFolderContext';
import { BookLibraryProvider } from './state/BookLibraryContext';
import { HomeScreen } from './screens/HomeScreen';
import { MyRecordingsScreen } from './screens/MyRecordingsScreen';
import { BookLibraryScreen } from './screens/BookLibraryScreen';
import { FirmwareScreen } from './screens/FirmwareScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { InternalBanner } from '@internal-ui';

export default function App() {
  const [section, setSection] = useState<Section>('home');

  return (
    <PenRootProvider>
      <ComputerFolderProvider>
        <BookLibraryProvider>
          {/* Nothing in a Store build: the component it resolves to renders null and carries
              no words. In the Internal build it is the first thing anyone sees. */}
          <InternalBanner />
          <div className="app-shell">
            <NavSidebar active={section} onSelect={setSection} />
            <main className="app-content">
              {section === 'home' && <HomeScreen onNavigate={setSection} />}
              {section === 'recordings' && <MyRecordingsScreen />}
              {section === 'book' && <BookLibraryScreen onNavigate={setSection} />}
              {section === 'firmware' && <FirmwareScreen onNavigate={setSection} />}
              {section === 'settings' && <SettingsScreen />}
            </main>
          </div>
        </BookLibraryProvider>
      </ComputerFolderProvider>
    </PenRootProvider>
  );
}
