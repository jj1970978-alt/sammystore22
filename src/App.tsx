import { useEffect, useState } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import { ROUTES, SectionType, getSectionFromPath, getRouteBySection } from './config/routes';

function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const [currentSection, setCurrentSection] = useState<SectionType>(() => 
    getSectionFromPath(location.pathname)
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Keep currentSection in sync with URL
  useEffect(() => {
    const section = getSectionFromPath(location.pathname);
    setCurrentSection(section);
  }, [location.pathname]);

  // Handle sidebar navigation
  const handleSectionChange = (section: SectionType) => {
    setCurrentSection(section);
    setSidebarOpen(false);
    
    const route = getRouteBySection(section);
    if (route && location.pathname !== route.path) {
      navigate(route.path);
    }
  };

  const pageTitle = currentSection.charAt(0).toUpperCase() + currentSection.slice(1);

  return (
    <div className="flex h-screen bg-[#0a0a0f]">
      <Sidebar
        currentSection={currentSection}
        onSectionChange={handleSectionChange}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar pageTitle={pageTitle} />

        <main className="flex-1 overflow-auto">
          <div className="p-4 lg:p-8">
            <Routes>
              {ROUTES.map(route => (
                <Route key={route.path} path={route.path} element={route.component} />
              ))}
              <Route path="*" element={ROUTES[0].component} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
