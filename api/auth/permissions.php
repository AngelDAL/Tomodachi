<?php
header('Content-Type: application/json');
require_once '../../config/constants.php';
// require_once '../../config/database.php'; // Uncomment when implementing DB check

if (session_status() === PHP_SESSION_NONE) {
    session_name(SESSION_NAME);
    session_start();
}

$response = [
    'success' => true,
    'mode' => APP_MODE,
    'plan' => 'unknown',
    'permissions' => []
];

// Definition of plans and their permissions (SAAS Mode)
// This could be moved to a DB table 'plans' and 'plan_features'
$saas_plans = [
    'free' => [
        'sales' => true,
        'inventory' => true,
        'basic_reports' => true,
        'customization' => false,
        'kiosk_mode' => false,
        'dictation' => false,
        'ticket_customization' => false,
        'max_users' => 3
    ],
    'premium' => [
        'sales' => true,
        'inventory' => true,
        'basic_reports' => true,
        'customization' => true,
        'kiosk_mode' => true,
        'dictation' => true,
        'ticket_customization' => true,
        'max_users' => 999
    ]
];

// Open Source always has everything enabled
$opensource_permissions = [
    'sales' => true,
    'inventory' => true,
    'basic_reports' => true,
    'customization' => true, // Developer can customize code
    'kiosk_mode' => true,
    'dictation' => true,
    'ticket_customization' => true,
    'ai_tools' => true,  // New feature
    'max_users' => 999
];

// Add AI tools to Premium plan
$saas_plans['premium']['ai_tools'] = true;
$saas_plans['free']['ai_tools'] = false;

// Determine Plan
if (APP_MODE === 'OPEN_SOURCE') {
    $response['plan'] = 'opensource';
    $response['permissions'] = $opensource_permissions;
} else {
    // SAAS Mode - Check Session
    if (isset($_SESSION['subscription_plan'])) {
        $userPlan = $_SESSION['subscription_plan']; // 'free' or 'premium'
    } else {
        $userPlan = 'free'; // Default fall back
    }
    
    // Validate plan exists in config, otherwise default to free
    if (!array_key_exists($userPlan, $saas_plans)) {
        $userPlan = 'free';
    }

    $response['plan'] = $userPlan;
    $response['permissions'] = $saas_plans[$userPlan];
}

echo json_encode($response);
exit;
