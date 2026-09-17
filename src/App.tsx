import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { TabBar } from './app/TabBar'
import { ProductDetail } from './app/pages/drugs/ProductDetail'
import { ProductForm } from './app/pages/drugs/ProductForm'
import { ProductList } from './app/pages/drugs/ProductList'
import { PresentationForm } from './app/pages/drugs/PresentationForm'
import { Home } from './app/pages/Home'
import { ItemsFiltered } from './app/pages/ItemsFiltered'
import { LocationForm } from './app/pages/locations/LocationForm'
import { LocationsList } from './app/pages/locations/LocationsList'
import { PersonDetail } from './app/pages/requests/PersonDetail'
import { NewRequest } from './app/pages/requests/NewRequest'
import { RequestDetail } from './app/pages/requests/RequestDetail'
import { RequestHandover } from './app/pages/requests/RequestHandover'
import { RequestsList } from './app/pages/requests/RequestsList'
import { ShoppingList } from './app/pages/requests/ShoppingList'
import { Search } from './app/pages/Search'
import { Settings } from './app/pages/settings/Settings'
import './app/pages/pages.css'
import { db } from './db/schema'
import { ensureSeeded } from './db/seedImport'
import { PinLock } from './ui/PinLock'
import { ToastProvider } from './ui/Toast'

function App() {
  useEffect(() => {
    ensureSeeded(db).catch((err) => {
      console.error('Seed import failed', err)
    })
  }, [])

  return (
    <PinLock>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/items/:filter" element={<ItemsFiltered />} />
          <Route path="/shopping" element={<ShoppingList />} />

          <Route path="/requests" element={<RequestsList />} />
          <Route path="/requests/:requestId" element={<RequestDetail />} />
          <Route path="/requests/:requestId/handover" element={<RequestHandover />} />
          <Route path="/add" element={<NewRequest />} />

          <Route path="/people/:personId" element={<PersonDetail />} />

          <Route path="/locations" element={<LocationsList />} />
          <Route path="/locations/new" element={<LocationForm />} />
          <Route path="/locations/:locationId/edit" element={<LocationForm />} />

          <Route path="/drugs" element={<ProductList />} />
          <Route path="/drugs/new" element={<ProductForm />} />
          <Route path="/drugs/:productId" element={<ProductDetail />} />
          <Route path="/drugs/:productId/edit" element={<ProductForm />} />
          <Route path="/drugs/:productId/presentations/new" element={<PresentationForm />} />
          <Route
            path="/drugs/:productId/presentations/:presentationId/edit"
            element={<PresentationForm />}
          />

          <Route path="/search" element={<Search />} />
        </Routes>
        <TabBar />
      </ToastProvider>
    </PinLock>
  )
}

export default App
