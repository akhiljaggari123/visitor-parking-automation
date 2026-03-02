const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const nodemailer = require('nodemailer');
const axios = require('axios');

const STATE_FILE = path.join(__dirname, 'state.json');
const CONFIG = {
    url: 'https://www.register2park.com/register?key=64gthiw8g0vr',
    apt: '243',
    make: 'Toyota',
    model: 'Prius',
    licensePlate: 'TLZ0200',
    dryRun: process.argv.includes('--dry-run'),
    notifications: {
        email: {
            enabled: true,
            user: 'akhiljaggari@gmail.com',
            pass: 'dzbbmlculakxmbyu',
            to: 'akhiljaggari@gmail.com'
        },
        iphone: {
            enabled: true, // Set to true to enable
            topic: 'car' // Updated to user's choice
        }
    }
};

async function notify(message, attachmentPath = null) {
    // 1. macOS System Notification
    const command = `osascript -e 'display notification "${message}" with title "Parking Automation"'`;
    exec(command);
    console.log(`NOTIFICATION: ${message}`);

    // 2. iPhone Notification (via ntfy.sh)
    if (CONFIG.notifications.iphone.enabled) {
        try {
            await axios.post(`https://ntfy.sh/${CONFIG.notifications.iphone.topic}`, message);
            console.log('iPhone notification sent via ntfy');
        } catch (error) {
            console.error('Error sending iPhone notification:', error.message);
        }
    }

    // 3. Email Notification
    if (CONFIG.notifications.email.enabled) {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: CONFIG.notifications.email.user,
                pass: CONFIG.notifications.email.pass
            }
        });

        const mailOptions = {
            from: CONFIG.notifications.email.user,
            to: CONFIG.notifications.email.to,
            subject: 'Parking Automation Alert',
            text: message
        };

        if (attachmentPath && fs.existsSync(attachmentPath)) {
            mailOptions.attachments = [
                {
                    filename: path.basename(attachmentPath),
                    path: attachmentPath
                }
            ];
        }

        try {
            await transporter.sendMail(mailOptions);
            console.log('Email sent successfully');
        } catch (error) {
            console.error('Error sending email:', error.message);
        }
    }
}

async function register() {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const today = new Date().toISOString().split('T')[0];

    if (state.lastRegistrationDate === today) {
        console.log('Already registered today.');
        return;
    }

    console.log(`Attempting registration for ${today}...`);

    if (CONFIG.licensePlate === 'PLACEHOLDER') {
        notify('ERROR: License plate is missing. Update register.js!');
        process.exit(1);
    }

    if (CONFIG.dryRun) {
        console.log('DRY RUN: Skipping actual registration.');
    } else {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
            await page.click('#registrationTypeVisitor');
            await page.waitForSelector('#vehicleApt');

            await page.fill('#vehicleApt', CONFIG.apt);
            await page.fill('#vehicleMake', CONFIG.make);
            await page.fill('#vehicleModel', CONFIG.model);
            await page.fill('#vehicleLicensePlate', CONFIG.licensePlate);
            await page.fill('#vehicleLicensePlateConfirm', CONFIG.licensePlate);

            await page.click('#vehicleInformation');

            // Wait for response screen
            await page.waitForTimeout(5000);
            const content = await page.content();
            const lowerContent = content.toLowerCase();
            const screenshotPath = path.join(__dirname, `registration_${today}.png`);
            await page.screenshot({ path: screenshotPath });

            if (content.includes('Approved')) {
                console.log('Registration successful!');
                state.consecutiveDays += 1;
                state.onBreak = false;
                await notify(`Registration successful. Day ${state.consecutiveDays} in a row.`, screenshotPath);
            } else if (lowerContent.includes('limit') || lowerContent.includes('maximum') || lowerContent.includes('exceeded') || lowerContent.includes('break')) {
                console.log('Limit reached according to website.');
                state.onBreak = true;
                state.consecutiveDays = 3; // Ensure we mark it as maxed
                await notify('WEBSITE LIMIT REACHED: Take your car out! A 24-hour break is required.', screenshotPath);
            } else {
                throw new Error('Unexpected response from website. Please check the screenshot.');
            }
        } catch (error) {
            console.error('Registration error:', error);
            const errorScreenshot = path.join(__dirname, 'error_registration.png');
            await page.screenshot({ path: errorScreenshot });
            await notify('Registration error! Please check manually.', errorScreenshot);
            await browser.close();
            process.exit(1);
        }
        await browser.close();
    }

    // Update state
    state.lastRegistrationDate = today;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

register().catch(err => {
    console.error(err);
    process.exit(1);
});
