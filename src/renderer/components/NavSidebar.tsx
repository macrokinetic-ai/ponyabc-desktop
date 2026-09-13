import { useTranslation } from 'react-i18next';

export type Section = 'home' | 'recordings' | 'book' | 'firmware' | 'settings';

const SECTIONS: Array<{ id: Section; labelKey: string }> = [
  { id: 'home', labelKey: 'nav.home' },
  { id: 'recordings', labelKey: 'nav.myRecordings' },
  { id: 'book', labelKey: 'nav.bookLibrary' },
  { id: 'firmware', labelKey: 'nav.firmware' },
  { id: 'settings', labelKey: 'nav.settings' },
];

export function NavSidebar({ active, onSelect }: { active: Section; onSelect: (section: Section) => void }) {
  const { t } = useTranslation('common');

  return (
    <nav className="nav-sidebar">
      <div className="nav-sidebar__title">{t('appName')}</div>
      <ul>
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className={section.id === active ? 'nav-item nav-item--active' : 'nav-item'}
              onClick={() => onSelect(section.id)}
            >
              {t(section.labelKey)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
