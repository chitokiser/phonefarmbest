import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// No React.StrictMode: DeviceTile owns a live device connection (WebSocket + hardware
// decoder) per mount, and StrictMode's dev-only double-invoke of effects opens two
// competing connections to the same physical device.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
