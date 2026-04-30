@echo off
:: -------------------------------------------------------
:: TOOL:    Fitness Tracker
:: SCRIPT:  fitness.bat
:: PURPOSE: Open the Fitness Tracker web app in browser
:: -------------------------------------------------------

set URL=REPLACE_WITH_DEPLOY_URL

if "%URL%"=="REPLACE_WITH_DEPLOY_URL" (
    echo ERROR: Deploy URL not set. Run initFitness^(^) in Apps Script,
    echo deploy as a web app, then update the URL= line in this file.
    pause
    exit /b 1
)

echo Opening Fitness Tracker...
start "" "%URL%"
