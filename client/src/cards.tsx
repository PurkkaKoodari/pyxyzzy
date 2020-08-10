import React, {ComponentType, useEffect, useState} from "react"
import ReactDOM from "react-dom"
import "./cards.scss"
import {Lock} from "./utils"
import {AbstractCard, BlackCard, WhiteCard} from "./state"

// parsing and rendering of the card markup, as generated by convert_cards.py
const processCardText = (text: string, blackCard: boolean) => {
  const processedText: any[] = []
  let currentWord: any[] = []
  let currentHasBlank = false
  let currentPart = ""
  let currentItalic = false

  const endPart = () => {
    if (currentPart.length) {
      currentWord.push(currentItalic ? <em key={currentWord.length}>{currentPart}</em> : currentPart)
      currentPart = ""
    }
  }
  const endWord = () => {
    endPart()
    if (currentWord.length) {
      if (blackCard) {
        processedText.push(
          <span className={`word ${currentHasBlank ? "blank" : ""}`} key={processedText.length}>{currentWord}</span>
        )
      } else {
        processedText.push(...currentWord)
      }
      currentWord = []
      currentHasBlank = false
    }
  }
  for (let i = 0; i < text.length; i++) {
    let char = text[i]
    if (char === "\\") {
      const escaped = text[++i]
      if (blackCard && escaped === "_") {
        endPart()
        currentWord.push(<span className="blank" key={currentWord.length}>&nbsp;</span>)
        currentHasBlank = true
        continue
      } else if (escaped === "I" || escaped === "i") {
        endPart()
        currentItalic = escaped === "I"
        continue
      } else {
        char = escaped
      }
    }
    if (blackCard && char === " ") {
      endWord()
    } else {
      currentPart += char
    }
  }
  endWord()
  return processedText
}

const MINIMUM_TEXT_SIZE = 4
const MAXIMUM_TEXT_SIZE = 18

// card text sizes are cached here (as promises, so that if the size is queried before the computation finishes, we can
// just await the previous calculation and not start another)
const cardTextSizeCache: { [key: string]: Promise<number> } = {}

// since the #card-size-measurement container is shared by the code below, and the rendering process requires an
// async function, we must lock access to the container
let fontSizeComputerLock = new Lock()

interface CardProps<C extends AbstractCard> {
  card: C
  givenTextSize?: number
}

const computeCardTextSize = async <C extends AbstractCard>(CardComponent: ComponentType<CardProps<C>>, card: C) => {
  if (card.fontSizeCacheKey in cardTextSizeCache)
    return await cardTextSizeCache[card.fontSizeCacheKey]

  const promise = fontSizeComputerLock.acquire(async () => {
    const container = document.getElementById("card-size-measurement")!
    container.style.display = "block"

    let currentSize = MAXIMUM_TEXT_SIZE
    let bestFitting = MINIMUM_TEXT_SIZE
    // binary search to find optimal size
    let lowerBound = MINIMUM_TEXT_SIZE
    let upperBound = MAXIMUM_TEXT_SIZE
    for (let i = 0; i < 10; i++) {
      // render the component to compute text height
      await new Promise(resolve => {
        ReactDOM.render(<CardComponent card={card} givenTextSize={currentSize}/>, container, () => resolve())
      })
      const targetHeight = 180 - container.querySelector<HTMLElement>(".bottom")!.offsetHeight
      const textHeight = container.querySelector<HTMLElement>(".text")!.offsetHeight
      // descend into binary search, keeping track of the largest text size that fit on the card
      if (textHeight > targetHeight) {
        upperBound = currentSize
      } else {
        lowerBound = currentSize
        bestFitting = Math.max(currentSize, bestFitting)
        // short-circuit if the maximum size fits
        if (currentSize === MAXIMUM_TEXT_SIZE)
          break
      }
      currentSize = (lowerBound + upperBound) / 2
    }

    ReactDOM.unmountComponentAtNode(container)
    container.style.display = "none"

    return bestFitting
  })
  cardTextSizeCache[card.fontSizeCacheKey] = promise
  return await promise
}

// shared hook for BlackCard and WhiteCard for text size computation
const useCardTextSize = <C extends AbstractCard>(CardComponent: ComponentType<CardProps<C>>, card: C, givenTextSize?: number) => {
  const [computedTextSize, setComputedTextSize] = useState<number | null>(null)

  useEffect(() => {
    if (givenTextSize === undefined)
      computeCardTextSize(CardComponent, card).then(fontSize => setComputedTextSize(fontSize))
  }, [CardComponent, card, givenTextSize])

  return givenTextSize || computedTextSize || MAXIMUM_TEXT_SIZE
}

export const BlackCardView = ({ card, givenTextSize, scale }: { card: BlackCard, givenTextSize?: number, scale?: number }) => {
  const textSize = useCardTextSize(BlackCardView, card, givenTextSize)

  if (scale === undefined)
    scale = 1

  let drawPick = null
  if (card.drawCount !== 0) {
    drawPick =
      <div className="draw-pick">
        <div>DRAW <span className="number"><span>{card.drawCount}</span></span></div>
        <div>PICK <span className="number"><span>{card.pickCount}</span></span></div>
      </div>
  } else if (card.pickCount !== 1) {
    drawPick =
      <div className="draw-pick">
        <div>PICK <span className="number"><span>{card.pickCount}</span></span></div>
      </div>
  }
  return (
    <div className="black card">
      <div className="text" style={{fontSize: `${textSize * scale}px`}}>
        {processCardText(card.text, true)}
      </div>
      <div className="bottom">
        <div className="pack-name">{card.packName}</div>
        {drawPick}
      </div>
    </div>
  )
}

export const WhiteCardView = ({ card, picked, givenTextSize, scale, onClick }: { card: WhiteCard, picked?: boolean, givenTextSize?: number, scale?: number, onClick?: () => void }) => {
  const textSize = useCardTextSize(WhiteCardView, card, givenTextSize)

  if (scale === undefined)
    scale = 1

  return (
    <div className={`white card ${picked ? "picked" : ""}`} onClick={onClick}>
      <div className="text" style={{fontSize: `${textSize * scale}px`}}>
        {processCardText(card.text, false)}
      </div>
      <div className="bottom">
        <div className="pack-name">{card.packName}</div>
      </div>
    </div>
  )
}

export const WhiteCardPlaceholder = ({ active, onClick, text }: { active?: boolean, onClick?: () => void, text: string }) => {
  return (
    <div className={`placeholder white card ${active ? "selected" : ""}`} onClick={onClick}>
      <div className="text">{text}</div>
    </div>
  )
}

export const WhiteCardGroup = ({ cards, active, onClick }: { cards: any[], active?: boolean, onClick?: () => void }) => {
  return (
    <div className={`group ${cards.length > 1 ? "multi" : ""} ${active ? "selected" : ""}`} onClick={onClick}>
      {cards}
    </div>
  )
}