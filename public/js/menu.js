document.addEventListener('DOMContentLoaded', function() {
    const menuButton = document.querySelector('.menu-button');
    const dropdownContent = document.querySelector('.dropdown-content');

    menuButton.addEventListener('click', function() {
        dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
    });

    // Cerrar el menú desplegable si se hace clic fuera de él
    window.addEventListener('click', function(event) {
        if (!event.target.matches('.menu-button')) {
            if (dropdownContent.style.display === 'block') {
                dropdownContent.style.display = 'none';
            }
        }
    });
});
