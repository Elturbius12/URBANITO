import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Tipografía incluida en el programa: no depende de las fuentes instaladas en la PC
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './estilos.css'

class LimiteErrores extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('Error de interfaz:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="acceso"><div className="tarjeta-acceso">
          <h1>URBANITO</h1>
          <p style={{ margin: '12px 0' }}>Ocurrió un error en la pantalla. Sus datos están guardados.</p>
          <p className="texto-tenue mono" style={{ fontSize: 11, marginBottom: 12 }}>{String(this.state.error.message || this.state.error)}</p>
          <button className="boton primario" onClick={() => window.location.reload()}>Volver a cargar</button>
        </div></div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('raiz')).render(<LimiteErrores><App /></LimiteErrores>)
