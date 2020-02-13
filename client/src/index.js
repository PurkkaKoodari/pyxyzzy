import "bootstrap/dist/css/bootstrap-reboot.css"
import React from "react"
import ReactDOM from "react-dom"
import Modal from "react-modal"
import App from "./App"
import { toast } from "react-toastify"

Modal.setAppElement("#root")

toast.configure({
    hideProgressBar: true
})

ReactDOM.render(<App />, document.getElementById("root"))
