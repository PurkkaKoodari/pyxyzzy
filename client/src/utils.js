import { useEffect, useRef } from "react"

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
