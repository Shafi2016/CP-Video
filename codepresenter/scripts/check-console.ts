import { Builder, Browser, logging } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

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
        console.log('Navigating to http://localhost:8080/codepresenter ...');
        await driver.get('http://localhost:8080/codepresenter');

        // wait a bit for react to crash
        await new Promise(r => setTimeout(r, 3000));

        const logs = await driver.manage().logs().get(logging.Type.BROWSER);
        console.log('--- BROWSER CONSOLE LOGS ---');
        logs.forEach(entry => {
            console.log(`[${entry.level.name}] ${entry.message}`);
        });
        console.log('----------------------------');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await driver.quit();
    }
}

run();
