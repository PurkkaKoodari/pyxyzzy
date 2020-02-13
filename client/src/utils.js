import { useEffect, useRef } from "react"
import { toast } from "react-toastify"

export const useMounted = () => {
    const mounted = useRef({ is: false }).current
    useEffect(() => {
        mounted.is = true
        return () => {
            mounted.is = false
        }
    }, [])
    return mounted
}

export const unknownError = (error) => {
    console.error(error)
    toast.error("An unknown error occurred.")
}
