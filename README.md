# QRIS Dynamic Payment Generator

A lightweight browser-based QRIS payment generator that creates dynamic QR codes with nominal amounts and optional service fees. This project is built with plain HTML, CSS, and JavaScript, and runs entirely in the browser.

## Features

- Generate dynamic QRIS strings by converting a static base QRIS payload into a dynamic payment payload.
- Add a custom nominal amount in IDR.
- Optionally apply a service fee as either a percentage or a fixed amount.
- Automatically calculate CRC16 and update the QRIS payload.
- Scan a QR code using the device camera to load a base QRIS string.
- Display merchant name and city extracted from the QRIS payload.

## Files

- `index.html` — main application interface and page structure.
- `style.css` — responsive styling for the form and QR code display.
- `script.js` — all logic for QRIS payload generation, validation, camera scanning, and QR code rendering.

## How to use

1. Open `index.html` in a modern browser.
2. Paste a valid static QRIS base string into the textarea. The string should include `010211`, `5802ID`, and end with a 4-character dummy CRC placeholder.
3. Enter the desired nominal amount in IDR.
4. Choose whether to add a service fee. If enabled, select the fee type and enter the fee value.
5. Click `✨ GENERATE QR CODE & PAYMENT ✨` to create the QRIS payment string and display the QR code.
6. Use the `📋 Salin Raw QRIS` button to copy the generated raw QRIS string.

## Notes

- The base QRIS string must contain `010211` and `5802ID`.
- The script replaces the last 4 dummy characters with a valid CRC16 checksum.
- If service fee is enabled, the payload appends the appropriate fee field before `5802ID`.

## Browser support

This project works best in modern browsers with support for:

- `navigator.mediaDevices.getUserMedia` for camera scanning
- Canvas rendering for QR code generation

## License

MIT License
