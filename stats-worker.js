// stats-worker.js - Web Worker for heavy calculations

self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'UPDATE_STATS') {
        const stats = calculateStats(data);
        self.postMessage({
            type: 'STATS_UPDATED',
            stats: stats
        });
    }
};

function calculateStats(appData) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentYear = today.getFullYear();
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(today.getDate() + 30);

        let totalUsed = 0;
        let privateCount = 0;
        let completedPrivateCount = 0;
        
        let annualDaysUsedInCurrentPeriod = 0;
        let shortDaysUsedInCurrentPeriod = 0;
        let totalSplitDaysUsed = 0;

        const annualPeriod = appData.settings.annualVacationPeriod;
        const shortPeriod = appData.settings.shortVacationPeriod;

        let annualPeriodStart, annualPeriodEnd;
        const currentAnnualStart = new Date(currentYear, annualPeriod.startMonth - 1, annualPeriod.startDay);
        if (today < currentAnnualStart) {
            annualPeriodStart = new Date(currentYear - 1, annualPeriod.startMonth - 1, annualPeriod.startDay);
            annualPeriodEnd = new Date(currentYear, annualPeriod.endMonth - 1, annualPeriod.endDay);
        } else {
            annualPeriodStart = currentAnnualStart;
            annualPeriodEnd = new Date(currentYear, annualPeriod.endMonth - 1, annualPeriod.endDay);
        }

        let shortPeriodStart, shortPeriodEnd;
        const currentShortStart = new Date(currentYear, shortPeriod.startMonth - 1, shortPeriod.startDay);
        if (today < currentShortStart) {
            shortPeriodStart = new Date(currentYear - 1, shortPeriod.startMonth - 1, shortPeriod.startDay);
            shortPeriodEnd = new Date(currentYear, shortPeriod.endMonth - 1, shortPeriod.endDay);
        } else {
            shortPeriodStart = currentShortStart;
            shortPeriodEnd = new Date(currentYear + 1, shortPeriod.endMonth - 1, shortPeriod.endDay);
        }

        const vacationsToProcess = appData.vacations.slice(0, 100);

        for (const vacation of vacationsToProcess) {
            try {
                // Parse date function implementation for worker
                const parsedStartDate = parseLocalDate(vacation.startDate);
                const parsedEndDate = parseLocalDate(vacation.endDate);

                if (!parsedStartDate || !parsedEndDate) {
                    console.warn('Invalid date found in vacation:', vacation);
                    continue;
                }

                if (vacation.type === 'annual') {
                    if (parsedStartDate >= annualPeriodStart && parsedStartDate <= annualPeriodEnd) {
                        annualDaysUsedInCurrentPeriod += vacation.days;
                    }
                } else if (vacation.type === 'short') {
                    if (parsedStartDate >= shortPeriodStart && parsedStartDate <= shortPeriodEnd) {
                        shortDaysUsedInCurrentPeriod += vacation.days;
                    }
                } else if (vacation.type === 'split') {
                    totalSplitDaysUsed += vacation.days;
                } else if (vacation.type === 'private') {
                    // Count private vacations only for the current year
                    const vacationYear = new Date(vacation.startDate).getFullYear();
                    if (vacationYear === currentYear) {
                        privateCount++;
                        if (vacation.status === 'completed') {
                            completedPrivateCount++;
                        }
                    }
                }

                const daysUsed = calculateDaysBetween(vacation.startDate, vacation.endDate);
                totalUsed += daysUsed;


            } catch (error) {
                console.error('Error processing vacation in worker:', vacation, error);
                continue;
            }
        }

        // Calculate and store the results
        const calculatedStats = {
            totalUsed: totalUsed,
            annualBalance: Math.max(0, 30 - annualDaysUsedInCurrentPeriod), // Assuming default of 30 days
            splitBalance: Math.max(0, 30 - totalSplitDaysUsed), // Assuming default of 30 days
            privateCount: privateCount,
            completedPrivateCount: completedPrivateCount
        };
        
        // Handle short balance calculation separately due to user type dependency
        if (appData.userType === 'continuous') {
            if (shortDaysUsedInCurrentPeriod > 0) {
                calculatedStats.shortBalance = 0;
                
                const latestShortVacation = appData.vacations
                    .filter(v => v.type === 'short')
                    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];
                
                if (latestShortVacation && (!appData.settings.shortVacationStart || 
                    new Date(latestShortVacation.startDate) > new Date(appData.settings.shortVacationStart))) {
                    // Note: We won't update appData.settings here since worker doesn't have access to main app state
                }
            } else if (appData.settings.shortVacationStart) {
                const lastShortDate = parseLocalDate(appData.settings.shortVacationStart);
                if (lastShortDate) {
                    const daysSinceLastShort = Math.floor((today - lastShortDate) / (1000 * 60 * 60 * 24));
                    if (daysSinceLastShort < appData.settings.shortVacationCooldown) {
                        calculatedStats.shortBalance = 0;
                    } else {
                        calculatedStats.shortBalance = appData.settings.shortVacationDays;
                    }
                }
            } else {
                calculatedStats.shortBalance = appData.settings.shortVacationDays;
            }
        } else {
            calculatedStats.shortBalance = appData.stats.shortBalance || 0; // Preserve for non-continuous users
        }

        return calculatedStats;
    } catch (error) {
        console.error('Error in stats calculation worker:', error);
        // Return default stats in case of error
        return {
            totalUsed: 0,
            annualBalance: 30,
            splitBalance: 30,
            privateCount: 0,
            completedPrivateCount: 0,
            shortBalance: 6
        };
    }
}

// Helper function for date parsing in worker
function parseLocalDate(dateStr) {
    if (!dateStr) {
        return null;
    }
    
    try {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr)) {
            return null;
        }
        
        const [year, month, day] = dateStr.split('-').map(Number);
        
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
            return null;
        }
        
        if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
            return null;
        }
        
        // Create date in local timezone
        const date = new Date(year, month - 1, day);
        
        if (isNaN(date.getTime()) || 
            date.getFullYear() !== year || 
            date.getMonth() !== month - 1 || 
            date.getDate() !== day) {
            return null;
        }
        
        return date;
    } catch (error) {
        return null;
    }
}

// Helper function for day calculation in worker
function calculateDaysBetween(startDate, endDate) {
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    if (!start || !end) return 0;

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(end - start);
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
}