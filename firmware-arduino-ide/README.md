# Arduino IDE version of the terminal firmware

Same code as `../firmware` (which uses PlatformIO). Use ONE of the two, not both.

1. Install Arduino IDE 2 (arduino.cc).
2. File > Preferences > "Additional boards manager URLs", paste:
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
3. Tools > Board > Boards Manager > search "esp32" > install "esp32 by Espressif Systems",
   choosing version 2.0.17 in the version drop-down. Do NOT use 3.x (the LED PWM calls changed).
4. Sketch > Include Library > Manage Libraries, install:
   - MFRC522 (GithubCommunity)
   - LiquidCrystal I2C (Frank de Brabander; if it fails to compile, try the one by Marco Schwartz)
   - RTClib (Adafruit), and click "Install all" for its dependency (Adafruit BusIO)
   - ArduinoJson (Benoit Blanchon), version 7.x
5. File > Open > mmu_terminal/mmu_terminal.ino  (three tabs appear: .ino, main.cpp, config.h)
6. In the config.h tab set Wi-Fi, API_BASE, ROOM_CODE, DEVICE_KEY and the LCD size.
7. Tools: Board = "ESP32 Dev Module"; Partition Scheme = "Default 4MB with spiffs";
   Upload Speed = 115200; Port = your ESP32's COM port.
8. Click Upload (arrow). If it hangs on "Connecting...", hold the BOOT button on the board.
9. Tools > Serial Monitor at 115200 baud.

No COM port? Install the USB driver for your board's chip (CP210x or CH340).
