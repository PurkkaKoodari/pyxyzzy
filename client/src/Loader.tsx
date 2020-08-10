import React from "react"
import "./Loader.scss"

const Loader = ({ children, className }: { children?: any, className?: string }) => {
  return (
    <div className={(className || "") + " loader"}>
      <div className="lds-ripple"><div /><div /></div>
      <div className="loader-text">{children}</div>
    </div>
  )
}

export default Loader
