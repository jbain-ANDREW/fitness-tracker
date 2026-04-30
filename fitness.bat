@echo off
:: -------------------------------------------------------
:: TOOL:    Fitness Tracker
:: SCRIPT:  fitness.bat
:: PURPOSE: Open the Fitness Tracker web app in browser
:: -------------------------------------------------------

set URL=https://script.google.com/macros/s/AKfycbwtvFWIPr8-aT0AyCcHmCw9Mjx9F8O6YlOb6ZMBYY0HeOtDDxJNI3dX9eYiuy6iAcs_yg/exec

if "%URL%"=="REPLACE_WITH_DEPLOY_URL" (
    echo ERROR: Deploy URL not set. Run initFitness^(^) in Apps Script,
    echo deploy as a web app, then update the URL= line in this file.
    pause
    exit /b 1
)

echo Opening Fitness Tracker...
start "" "%URL%"
