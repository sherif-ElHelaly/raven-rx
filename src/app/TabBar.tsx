import { NavLink } from 'react-router-dom'
import './TabBar.css'

const TABS = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/requests', label: 'Requests', icon: '☰' },
  { to: '/add', label: '＋', icon: '＋' },
  { to: '/drugs', label: 'Drugs', icon: 'Rx' },
  { to: '/search', label: 'Search', icon: '⌕' },
] as const

export function TabBar() {
  return (
    <nav className="tab-bar">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `tab-bar__item${isActive ? ' tab-bar__item--active' : ''}${
              tab.to === '/add' ? ' tab-bar__item--primary' : ''
            }`
          }
        >
          <span className="tab-bar__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="tab-bar__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
