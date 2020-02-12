import React from "react"
import "./Loader.css"

const Loader = ({ children, className }) => {
  return (
    <div className={(className || "") + " loader"}>
      <div className="lds-ripple"><div></div><div></div></div>
      <div className="loader-text">{children}</div>
    </div>
  )
}

export default Loader
