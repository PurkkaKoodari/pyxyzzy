import "bootstrap/dist/css/bootstrap-reboot.css"
import React from "react"
import ReactDOM from "react-dom"
import Modal from "react-modal"
import App from "./App"
import { toast } from "react-toastify"
import log from "loglevel"

Modal.setAppElement("#root")

toast.configure({
    autoClose: 8000,
})

if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
    log.setLevel("debug")
}

ReactDOM.render(<App />, document.getElementById("root"))
