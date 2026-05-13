import { Builder, Browser, logging } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs';

async function run() {
    const prefs = new logging.Preferences();
    prefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);

    const options = new chrome.Options();
    options.addArguments('--headless');
    options.addArguments('--disable-gpu');
    options.addArguments('--no-sandbox');
    options.setLoggingPrefs(prefs);

    const driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(options)
        .build();

    try {
        await driver.get('http://localhost:8080/codepresenter');
        await new Promise(r => setTimeout(r, 2000));
        const image = await driver.takeScreenshot();
        fs.writeFileSync('screenshot.png', image, 'base64');
        console.log('Saved screenshot to screenshot.png');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await driver.quit();
    }
}

run();
